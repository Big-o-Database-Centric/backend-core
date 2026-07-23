-- ============================================================
-- 002-oauth.sql — OAuth support (Google/GitHub), additive.
-- Idempotent: safe to run multiple times. Does NOT drop Users.
-- Run after scripts/sql/schema.sql.
-- ============================================================

-- --- Users: make password columns nullable (OAuth-only users have none) ---
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'PasswordHash' AND is_nullable = 0
)
BEGIN
    ALTER TABLE dbo.Users ALTER COLUMN PasswordHash VARBINARY(32) NULL;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'PasswordSalt' AND is_nullable = 0
)
BEGIN
    ALTER TABLE dbo.Users ALTER COLUMN PasswordSalt UNIQUEIDENTIFIER NULL;
END
GO

-- --- OAuth accounts: one row per linked provider identity ---
IF OBJECT_ID('dbo.UserOAuthAccounts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserOAuthAccounts (
        OAuthAccountId    INT IDENTITY(1,1) PRIMARY KEY,
        UserId            INT           NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
        Provider          NVARCHAR(20)  NOT NULL,
        ProviderAccountId NVARCHAR(255) NOT NULL,
        LinkedAt          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UX_UserOAuthAccounts UNIQUE (Provider, ProviderAccountId)
    );
END
GO

-- --- sp_Login: guard against NULL hash (OAuth-only users) ---
-- Without the IS NULL check, `NULL <> hash` is NULL, so `false OR NULL`
-- falls through to session creation, letting anyone log into an OAuth-only
-- account with any password.
CREATE OR ALTER PROCEDURE dbo.sp_Login
    @Email    NVARCHAR(256),
    @Password NVARCHAR(256)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT, @Salt UNIQUEIDENTIFIER, @StoredHash VARBINARY(32), @Name NVARCHAR(100);

    SELECT @UserId = UserId, @Salt = PasswordSalt, @StoredHash = PasswordHash, @Name = Name
    FROM dbo.Users
    WHERE Email = @Email;

    IF @UserId IS NULL OR @StoredHash IS NULL OR @Salt IS NULL
       OR @StoredHash <> HASHBYTES('SHA2_256', CONVERT(NVARCHAR(36), @Salt) + @Password)
    BEGIN
        SELECT
            CAST(0 AS BIT) AS Success, 'Invalid credentials' AS Message,
            CAST(NULL AS INT) AS UserId, CAST(NULL AS UNIQUEIDENTIFIER) AS SessionToken,
            CAST(NULL AS NVARCHAR(100)) AS Name, CAST(NULL AS NVARCHAR(256)) AS Email;
        RETURN;
    END

    DECLARE @Token UNIQUEIDENTIFIER = NEWID();
    INSERT INTO dbo.Sessions (SessionToken, UserId, ExpiresAt)
    VALUES (@Token, @UserId, DATEADD(DAY, 7, SYSUTCDATETIME()));

    SELECT CAST(1 AS BIT) AS Success, 'OK' AS Message, @UserId AS UserId,
           @Token AS SessionToken, @Name AS Name, @Email AS Email;
END
GO

-- --- sp_Logout: invalidate the session server-side ---
CREATE OR ALTER PROCEDURE dbo.sp_Logout
    @SessionToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.Sessions WHERE SessionToken = @SessionToken;
    SELECT CAST(1 AS BIT) AS Success;
END
GO

-- --- sp_OAuthLogin: find-or-link-or-create, then create session ---
CREATE OR ALTER PROCEDURE dbo.sp_OAuthLogin
    @Provider          NVARCHAR(20),
    @ProviderAccountId NVARCHAR(255),
    @Email             NVARCHAR(256),
    @Name              NVARCHAR(100),
    @EmailVerified     BIT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT, @ResolvedName NVARCHAR(100), @ResolvedEmail NVARCHAR(256);

    -- 1. Known provider identity → that user.
    SELECT @UserId = UserId FROM dbo.UserOAuthAccounts
    WHERE Provider = @Provider AND ProviderAccountId = @ProviderAccountId;

    IF @UserId IS NULL
    BEGIN
        -- 2. Unknown identity requires a verified email to link/create.
        IF @EmailVerified = 0 OR @Email IS NULL
        BEGIN
            SELECT CAST(0 AS BIT) AS Success, 'Email no verificado por el proveedor' AS Message,
                   CAST(NULL AS INT) AS UserId, CAST(NULL AS UNIQUEIDENTIFIER) AS SessionToken,
                   CAST(NULL AS NVARCHAR(100)) AS Name, CAST(NULL AS NVARCHAR(256)) AS Email;
            RETURN;
        END

        BEGIN TRY
            BEGIN TRANSACTION;

            -- 3. Existing email-user → link. Otherwise create.
            SELECT @UserId = UserId FROM dbo.Users WHERE Email = @Email;

            IF @UserId IS NULL
            BEGIN
                INSERT INTO dbo.Users (Name, Email, PasswordSalt, PasswordHash)
                VALUES (@Name, @Email, NULL, NULL);
                SET @UserId = CAST(SCOPE_IDENTITY() AS INT);
            END

            INSERT INTO dbo.UserOAuthAccounts (UserId, Provider, ProviderAccountId)
            VALUES (@UserId, @Provider, @ProviderAccountId);

            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            -- Concurrent create of the same identity/email: re-resolve.
            IF ERROR_NUMBER() IN (2627, 2601)
            BEGIN
                SELECT @UserId = UserId FROM dbo.UserOAuthAccounts
                WHERE Provider = @Provider AND ProviderAccountId = @ProviderAccountId;
                IF @UserId IS NULL
                    SELECT @UserId = UserId FROM dbo.Users WHERE Email = @Email;
            END
            ELSE THROW;
        END CATCH
    END

    -- 4. Create the session and return the sp_Login-shaped row.
    SELECT @ResolvedName = Name, @ResolvedEmail = Email FROM dbo.Users WHERE UserId = @UserId;

    DECLARE @Token UNIQUEIDENTIFIER = NEWID();
    INSERT INTO dbo.Sessions (SessionToken, UserId, ExpiresAt)
    VALUES (@Token, @UserId, DATEADD(DAY, 7, SYSUTCDATETIME()));

    SELECT CAST(1 AS BIT) AS Success, 'OK' AS Message, @UserId AS UserId,
           @Token AS SessionToken, @ResolvedName AS Name, @ResolvedEmail AS Email;
END
GO

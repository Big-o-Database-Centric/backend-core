-- ============================================================
-- Big-O Database-Centric Platform — schema + stored procedures
-- Replaces the old OAuth-based scripts/sql/auth.sql.
-- Run once against the target database before starting the API.
-- ============================================================

IF OBJECT_ID('dbo.Sessions', 'U') IS NOT NULL DROP TABLE dbo.Sessions;
IF OBJECT_ID('dbo.UserDatabases', 'U') IS NOT NULL DROP TABLE dbo.UserDatabases;
IF OBJECT_ID('dbo.UserOAuthAccounts', 'U') IS NOT NULL DROP TABLE dbo.UserOAuthAccounts;
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL DROP TABLE dbo.Users;
GO

CREATE TABLE dbo.Users (
    UserId       INT IDENTITY(1,1) PRIMARY KEY,
    Name         NVARCHAR(100)    NOT NULL,
    Email        NVARCHAR(256)    NOT NULL UNIQUE,
    PasswordSalt UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    PasswordHash VARBINARY(32)    NOT NULL,
    CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.Sessions (
    SessionToken UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    UserId       INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiresAt    DATETIME2 NOT NULL
);
GO

CREATE TABLE dbo.UserDatabases (
    DatabaseId   INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    DatabaseName NVARCHAR(100) NOT NULL,
    Engine       NVARCHAR(50)  NOT NULL,
    CreatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- ============================================================
-- sp_Register(@Name, @Email, @Password)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_Register
    @Name     NVARCHAR(100),
    @Email    NVARCHAR(256),
    @Password NVARCHAR(256)
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.Users WHERE Email = @Email)
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Email already registered' AS Message, CAST(NULL AS INT) AS UserId;
        RETURN;
    END

    DECLARE @Salt UNIQUEIDENTIFIER = NEWID();
    DECLARE @Hash VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(36), @Salt) + @Password);

    BEGIN TRY
        INSERT INTO dbo.Users (Name, Email, PasswordSalt, PasswordHash)
        VALUES (@Name, @Email, @Salt, @Hash);

        SELECT CAST(1 AS BIT) AS Success, 'Registered' AS Message, CAST(SCOPE_IDENTITY() AS INT) AS UserId;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() IN (2627, 2601)
        BEGIN
            SELECT CAST(0 AS BIT) AS Success, 'Email already registered' AS Message, CAST(NULL AS INT) AS UserId;
            RETURN;
        END
        THROW;
    END CATCH
END
GO

-- ============================================================
-- sp_Login(@Email, @Password)
-- ============================================================
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

    IF @UserId IS NULL OR @StoredHash <> HASHBYTES('SHA2_256', CONVERT(NVARCHAR(36), @Salt) + @Password)
    BEGIN
        SELECT
            CAST(0 AS BIT) AS Success,
            'Invalid credentials' AS Message,
            CAST(NULL AS INT) AS UserId,
            CAST(NULL AS UNIQUEIDENTIFIER) AS SessionToken,
            CAST(NULL AS NVARCHAR(100)) AS Name,
            CAST(NULL AS NVARCHAR(256)) AS Email;
        RETURN;
    END

    DECLARE @Token UNIQUEIDENTIFIER = NEWID();
    INSERT INTO dbo.Sessions (SessionToken, UserId, ExpiresAt)
    VALUES (@Token, @UserId, DATEADD(DAY, 7, SYSUTCDATETIME()));

    SELECT
        CAST(1 AS BIT) AS Success,
        'OK' AS Message,
        @UserId AS UserId,
        @Token AS SessionToken,
        @Name AS Name,
        @Email AS Email;
END
GO

-- ============================================================
-- sp_GetPlatformStats()
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_GetPlatformStats
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        (SELECT COUNT(*) FROM dbo.Users)                                                          AS TotalUsers,
        (SELECT COUNT(*) FROM dbo.UserDatabases)                                                   AS TotalDatabases,
        (SELECT COUNT(*) FROM dbo.Sessions WHERE ExpiresAt > SYSUTCDATETIME())                     AS ActiveSessions,
        (SELECT COUNT(DISTINCT Engine) FROM dbo.UserDatabases)                                     AS EnginesSupported,
        (SELECT COUNT(*) FROM dbo.Users WHERE CreatedAt > DATEADD(DAY, -30, SYSUTCDATETIME()))     AS NewUsersLast30Days,
        (SELECT COUNT(*) FROM dbo.UserDatabases WHERE CreatedAt > DATEADD(DAY, -30, SYSUTCDATETIME())) AS NewDatabasesLast30Days;
END
GO

-- ============================================================
-- sp_GetUserInfo(@SessionToken)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_GetUserInfo
    @SessionToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT;

    SELECT @UserId = s.UserId
    FROM dbo.Sessions s
    WHERE s.SessionToken = @SessionToken AND s.ExpiresAt > SYSUTCDATETIME();

    IF @UserId IS NULL
    BEGIN
        SELECT
            CAST(0 AS BIT) AS Success,
            CAST(NULL AS INT) AS UserId,
            CAST(NULL AS NVARCHAR(100)) AS Name,
            CAST(NULL AS NVARCHAR(256)) AS Email;
        RETURN;
    END

    SELECT CAST(1 AS BIT) AS Success, UserId, Name, Email
    FROM dbo.Users
    WHERE UserId = @UserId;
END
GO

-- ============================================================
-- sp_GetUserDatabases(@SessionToken)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_GetUserDatabases
    @SessionToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT;

    SELECT @UserId = s.UserId
    FROM dbo.Sessions s
    WHERE s.SessionToken = @SessionToken AND s.ExpiresAt > SYSUTCDATETIME();

    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success;
        RETURN;
    END

    SELECT DatabaseId, DatabaseName, Engine, CreatedAt
    FROM dbo.UserDatabases
    WHERE UserId = @UserId;
END
GO

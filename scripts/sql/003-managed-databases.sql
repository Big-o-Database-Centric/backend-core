-- Big O managed databases: additive production migration.
-- Run once after schema.sql. It does not remove existing users or databases.

IF COL_LENGTH('dbo.UserDatabases', 'InstanceId') IS NULL
BEGIN
    ALTER TABLE dbo.UserDatabases ADD InstanceId UNIQUEIDENTIFIER NULL;
    ALTER TABLE dbo.UserDatabases ADD HostName NVARCHAR(255) NULL;
    ALTER TABLE dbo.UserDatabases ADD Port INT NULL;
    ALTER TABLE dbo.UserDatabases ADD DatabaseUser NVARCHAR(128) NULL;
    ALTER TABLE dbo.UserDatabases ADD EncryptedPassword VARBINARY(MAX) NULL;
    ALTER TABLE dbo.UserDatabases ADD QuotaBytes BIGINT NOT NULL CONSTRAINT DF_UserDatabases_QuotaBytes DEFAULT 20971520;
    ALTER TABLE dbo.UserDatabases ADD State NVARCHAR(20) NOT NULL CONSTRAINT DF_UserDatabases_State DEFAULT 'active';
    ALTER TABLE dbo.UserDatabases ADD FailureReason NVARCHAR(250) NULL;
    ALTER TABLE dbo.UserDatabases ADD ActivatedAt DATETIME2 NULL;
    ALTER TABLE dbo.UserDatabases ADD DeactivatedAt DATETIME2 NULL;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_ReserveManagedDatabase
    @SessionToken UNIQUEIDENTIFIER,
    @DatabaseName NVARCHAR(100),
    @Engine NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Email NVARCHAR(256), @DatabaseId INT;

    SELECT @UserId = s.UserId, @Email = u.Email
    FROM dbo.Sessions s
    INNER JOIN dbo.Users u ON u.UserId = s.UserId
    WHERE s.SessionToken = @SessionToken AND s.ExpiresAt > SYSUTCDATETIME();

    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Unauthorized' AS Message,
               CAST(NULL AS INT) AS DatabaseId, CAST(NULL AS INT) AS UserId,
               CAST(NULL AS NVARCHAR(256)) AS Email, CAST(NULL AS UNIQUEIDENTIFIER) AS InstanceId;
        RETURN;
    END

    BEGIN TRANSACTION;
    EXEC sp_getapplock @Resource = CONCAT('managed-database-user-', @UserId),
                        @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;

    IF (SELECT COUNT(*) FROM dbo.UserDatabases WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId AND State IN ('pending', 'active')) >= 3
    BEGIN
        ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS Success, 'Maximum of 3 active databases reached' AS Message,
               CAST(NULL AS INT) AS DatabaseId, @UserId AS UserId, @Email AS Email,
               CAST(NULL AS UNIQUEIDENTIFIER) AS InstanceId;
        RETURN;
    END

    DECLARE @InstanceId UNIQUEIDENTIFIER = NEWID();
    INSERT INTO dbo.UserDatabases (UserId, DatabaseName, Engine, InstanceId, State, QuotaBytes)
    VALUES (@UserId, @DatabaseName, @Engine, @InstanceId, 'pending', 20971520);
    SET @DatabaseId = SCOPE_IDENTITY();
    COMMIT TRANSACTION;

    SELECT CAST(1 AS BIT) AS Success, 'Reserved' AS Message, @DatabaseId AS DatabaseId,
           @UserId AS UserId, @Email AS Email, @InstanceId AS InstanceId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_ActivateManagedDatabase
    @DatabaseId INT, @HostName NVARCHAR(255), @Port INT, @DatabaseUser NVARCHAR(128), @EncryptedPassword VARBINARY(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.UserDatabases
    SET HostName = @HostName, Port = @Port, DatabaseUser = @DatabaseUser,
        EncryptedPassword = @EncryptedPassword, State = 'active', ActivatedAt = SYSUTCDATETIME(), FailureReason = NULL
    WHERE DatabaseId = @DatabaseId AND State = 'pending';
    SELECT CAST(IIF(@@ROWCOUNT = 1, 1, 0) AS BIT) AS Success;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_FailManagedDatabase
    @DatabaseId INT, @FailureReason NVARCHAR(250)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.UserDatabases SET State = 'failed', FailureReason = @FailureReason WHERE DatabaseId = @DatabaseId AND State = 'pending';
    SELECT CAST(IIF(@@ROWCOUNT = 1, 1, 0) AS BIT) AS Success;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_GetManagedDatabases @SessionToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT;
    SELECT @UserId = UserId FROM dbo.Sessions WHERE SessionToken = @SessionToken AND ExpiresAt > SYSUTCDATETIME();
    IF @UserId IS NULL BEGIN SELECT CAST(0 AS BIT) AS Success; RETURN; END
    SELECT DatabaseId, DatabaseName, Engine, InstanceId, HostName, Port, DatabaseUser, QuotaBytes, State, FailureReason, CreatedAt, ActivatedAt
    FROM dbo.UserDatabases WHERE UserId = @UserId ORDER BY CreatedAt DESC;
END
GO

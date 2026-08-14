-- Big O managed databases: additive production migration.
-- Run once after schema.sql. It does not remove existing users or databases.

IF COL_LENGTH('dbo.UserDatabases', 'InstanceId') IS NULL
    ALTER TABLE dbo.UserDatabases ADD InstanceId UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('dbo.UserDatabases', 'HostName') IS NULL
    ALTER TABLE dbo.UserDatabases ADD HostName NVARCHAR(255) NULL;
GO

IF COL_LENGTH('dbo.UserDatabases', 'Port') IS NULL
    ALTER TABLE dbo.UserDatabases ADD Port INT NULL;
GO

IF COL_LENGTH('dbo.UserDatabases', 'DatabaseUser') IS NULL
    ALTER TABLE dbo.UserDatabases ADD DatabaseUser NVARCHAR(128) NULL;
GO

IF COL_LENGTH('dbo.UserDatabases', 'EncryptedPassword') IS NULL
    ALTER TABLE dbo.UserDatabases ADD EncryptedPassword VARBINARY(MAX) NULL;
GO

IF COL_LENGTH('dbo.UserDatabases', 'QuotaBytes') IS NULL
    ALTER TABLE dbo.UserDatabases ADD QuotaBytes BIGINT NOT NULL CONSTRAINT DF_UserDatabases_QuotaBytes DEFAULT 20971520;
GO

IF COL_LENGTH('dbo.UserDatabases', 'State') IS NULL
    ALTER TABLE dbo.UserDatabases ADD State NVARCHAR(20) NOT NULL CONSTRAINT DF_UserDatabases_State DEFAULT 'active';
GO

IF COL_LENGTH('dbo.UserDatabases', 'FailureReason') IS NULL
    ALTER TABLE dbo.UserDatabases ADD FailureReason NVARCHAR(250) NULL;
GO

IF COL_LENGTH('dbo.UserDatabases', 'ActivatedAt') IS NULL
    ALTER TABLE dbo.UserDatabases ADD ActivatedAt DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.UserDatabases', 'DeactivatedAt') IS NULL
    ALTER TABLE dbo.UserDatabases ADD DeactivatedAt DATETIME2 NULL;
GO

CREATE OR ALTER PROCEDURE dbo.sp_ReserveManagedDatabase
    @SessionToken UNIQUEIDENTIFIER,
    @DatabaseName NVARCHAR(100),
    @Engine NVARCHAR(50),
    @MaxTotal INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Email NVARCHAR(256), @DatabaseId INT, @LockResource NVARCHAR(255);

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
    SET @LockResource = N'managed-database-capacity';
    EXEC sp_getapplock @Resource = @LockResource,
                        @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;

    IF @MaxTotal < 1 OR (SELECT COUNT(*) FROM dbo.UserDatabases WITH (UPDLOCK, HOLDLOCK)
        WHERE State IN ('pending', 'active', 'deleting')) >= @MaxTotal
    BEGIN
        ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS Success, 'Maximum managed database capacity reached' AS Message,
               CAST(NULL AS INT) AS DatabaseId, @UserId AS UserId, @Email AS Email,
               CAST(NULL AS UNIQUEIDENTIFIER) AS InstanceId;
        RETURN;
    END

    IF (SELECT COUNT(*) FROM dbo.UserDatabases WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId AND State IN ('pending', 'active', 'deleting')) >= 3
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

CREATE OR ALTER PROCEDURE dbo.sp_BeginDeleteManagedDatabase
    @SessionToken UNIQUEIDENTIFIER,
    @DatabaseId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Engine NVARCHAR(50), @InstanceId UNIQUEIDENTIFIER;

    SELECT @UserId = UserId FROM dbo.Sessions
    WHERE SessionToken = @SessionToken AND ExpiresAt > SYSUTCDATETIME();

    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Unauthorized' AS Message,
               CAST(NULL AS INT) AS DatabaseId, CAST(NULL AS NVARCHAR(50)) AS Engine,
               CAST(NULL AS UNIQUEIDENTIFIER) AS InstanceId;
        RETURN;
    END

    BEGIN TRANSACTION;
    SELECT @Engine = Engine, @InstanceId = InstanceId
    FROM dbo.UserDatabases WITH (UPDLOCK, HOLDLOCK)
    WHERE DatabaseId = @DatabaseId AND UserId = @UserId AND State IN ('active', 'failed');

    IF @Engine IS NULL OR @InstanceId IS NULL
    BEGIN
        ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS Success, 'Database not found' AS Message,
               CAST(NULL AS INT) AS DatabaseId, CAST(NULL AS NVARCHAR(50)) AS Engine,
               CAST(NULL AS UNIQUEIDENTIFIER) AS InstanceId;
        RETURN;
    END

    UPDATE dbo.UserDatabases SET State = 'deleting', FailureReason = NULL
    WHERE DatabaseId = @DatabaseId AND UserId = @UserId;
    COMMIT TRANSACTION;

    SELECT CAST(1 AS BIT) AS Success, 'Deleting' AS Message,
           @DatabaseId AS DatabaseId, @Engine AS Engine, @InstanceId AS InstanceId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_CompleteDeleteManagedDatabase @DatabaseId INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.UserDatabases WHERE DatabaseId = @DatabaseId AND State = 'deleting';
    SELECT CAST(IIF(@@ROWCOUNT = 1, 1, 0) AS BIT) AS Success;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_FailManagedDatabaseDeletion
    @DatabaseId INT, @FailureReason NVARCHAR(250)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.UserDatabases
    SET State = 'failed', FailureReason = @FailureReason
    WHERE DatabaseId = @DatabaseId AND State = 'deleting';
    SELECT CAST(IIF(@@ROWCOUNT = 1, 1, 0) AS BIT) AS Success;
END
GO

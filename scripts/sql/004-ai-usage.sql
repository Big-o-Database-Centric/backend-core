IF OBJECT_ID('dbo.AiRequests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AiRequests (
        RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AiRequests PRIMARY KEY,
        UserId INT NOT NULL,
        ReservedAt DATETIME2 NOT NULL,
        CompletedAt DATETIME2 NULL,
        State NVARCHAR(20) NOT NULL,
        ProviderStatus INT NULL,
        LatencyMs INT NULL,
        PromptTokens INT NULL,
        CompletionTokens INT NULL,
        TotalTokens INT NULL,
        CONSTRAINT FK_AiRequests_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId)
    );
    CREATE INDEX IX_AiRequests_User_ReservedAt ON dbo.AiRequests(UserId, ReservedAt);
    CREATE INDEX IX_AiRequests_ReservedAt ON dbo.AiRequests(ReservedAt);
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_ReserveAiRequest
    @SessionToken UNIQUEIDENTIFIER,
    @UserPerMinute INT,
    @UserPerDay INT,
    @GlobalPerMinute INT,
    @GlobalPerDay INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Now DATETIME2 = SYSUTCDATETIME(), @RequestId UNIQUEIDENTIFIER = NEWID();
    DECLARE @MinuteStart DATETIME2, @DayStart DATETIME2;
    DECLARE @UserMinuteCount INT, @UserDayCount INT, @GlobalMinuteCount INT, @GlobalDayCount INT;
    SET @MinuteStart = DATEADD(MINUTE, DATEDIFF(MINUTE, 0, @Now), 0);
    SET @DayStart = CONVERT(DATETIME2, CONVERT(DATE, @Now));

    SELECT @UserId = UserId FROM dbo.Sessions
    WHERE SessionToken = @SessionToken AND ExpiresAt > @Now;
    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Unauthorized' AS Message,
               CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId, CAST(NULL AS INT) AS RemainingToday;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @LockResult INT;
        EXEC @LockResult = sp_getapplock @Resource = N'ai-shared-quota',
            @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
        IF @LockResult < 0 THROW 51000, 'AI quota lock unavailable', 1;

        SELECT @UserMinuteCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId AND ReservedAt >= @MinuteStart;
        SELECT @UserDayCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId AND ReservedAt >= @DayStart;
        SELECT @GlobalMinuteCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE ReservedAt >= @MinuteStart;
        SELECT @GlobalDayCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE ReservedAt >= @DayStart;

        IF @UserMinuteCount >= @UserPerMinute OR @UserDayCount >= @UserPerDay
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT CAST(0 AS BIT) AS Success, 'User AI quota reached' AS Message,
                   CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId,
                   IIF(@UserPerDay > @UserDayCount, @UserPerDay - @UserDayCount, 0) AS RemainingToday;
            RETURN;
        END
        IF @GlobalMinuteCount >= @GlobalPerMinute OR @GlobalDayCount >= @GlobalPerDay
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT CAST(0 AS BIT) AS Success, 'Global AI quota reached' AS Message,
                   CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId,
                   IIF(@UserPerDay > @UserDayCount, @UserPerDay - @UserDayCount, 0) AS RemainingToday;
            RETURN;
        END

        INSERT dbo.AiRequests (RequestId, UserId, ReservedAt, State)
        VALUES (@RequestId, @UserId, @Now, 'reserved');
        COMMIT TRANSACTION;
        SELECT CAST(1 AS BIT) AS Success, 'Reserved' AS Message, @RequestId AS RequestId,
               @UserPerDay - @UserDayCount - 1 AS RemainingToday;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_CompleteAiRequest
    @RequestId UNIQUEIDENTIFIER, @State NVARCHAR(20), @ProviderStatus INT = NULL,
    @LatencyMs INT, @PromptTokens INT = NULL, @CompletionTokens INT = NULL, @TotalTokens INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @State NOT IN ('completed', 'failed') THROW 51001, 'Invalid AI request state', 1;
    UPDATE dbo.AiRequests SET State = @State, CompletedAt = SYSUTCDATETIME(),
        ProviderStatus = @ProviderStatus, LatencyMs = @LatencyMs,
        PromptTokens = @PromptTokens, CompletionTokens = @CompletionTokens, TotalTokens = @TotalTokens
    WHERE RequestId = @RequestId AND State = 'reserved';
    SELECT CAST(IIF(@@ROWCOUNT = 1, 1, 0) AS BIT) AS Success;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_GetAiCapabilities
    @SessionToken UNIQUEIDENTIFIER, @UserPerDay INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Now DATETIME2 = SYSUTCDATETIME(), @UsedToday INT;
    SELECT @UserId = UserId FROM dbo.Sessions
    WHERE SessionToken = @SessionToken AND ExpiresAt > @Now;
    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Unauthorized' AS Message,
               CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId, CAST(NULL AS INT) AS RemainingToday;
        RETURN;
    END
    SELECT @UsedToday = COUNT(*) FROM dbo.AiRequests
    WHERE UserId = @UserId AND ReservedAt >= CONVERT(DATETIME2, CONVERT(DATE, @Now));
    SELECT CAST(1 AS BIT) AS Success, 'Available' AS Message,
           CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId,
           IIF(@UserPerDay > @UsedToday, @UserPerDay - @UsedToday, 0) AS RemainingToday;
END
GO

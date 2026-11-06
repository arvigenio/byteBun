BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Bookings] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [LeadId] INT NOT NULL,
    [StartsAt] DATETIME2 NOT NULL,
    [TimeZone] NVARCHAR(64),
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Bookings_CreatedAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [Bookings_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Bookings_LeadId_key] UNIQUE NONCLUSTERED ([LeadId]),
    CONSTRAINT [Bookings_StartsAt_key] UNIQUE NONCLUSTERED ([StartsAt])
);

-- AddForeignKey
ALTER TABLE [dbo].[Bookings] ADD CONSTRAINT [Bookings_LeadId_fkey] FOREIGN KEY ([LeadId]) REFERENCES [dbo].[Leads]([Id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

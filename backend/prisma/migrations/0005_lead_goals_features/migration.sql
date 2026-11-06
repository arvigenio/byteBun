-- Lead page: goals (required on the form) and features of interest (optional) are stored as
-- JSON arrays of option keys (see src/leads/lead-options.ts). Business name becomes optional.
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Leads] ALTER COLUMN [BusinessName] NVARCHAR(160) NULL;
ALTER TABLE [dbo].[Leads] ADD [Goals] NVARCHAR(1000) NULL,
    [GoalsOther] NVARCHAR(200) NULL,
    [Features] NVARCHAR(1000) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

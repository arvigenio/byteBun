-- First and last name are stored separately (FirstName, LastName, added in 0002); the combined
-- Name column is no longer written or read. Every existing row already has FirstName/LastName.
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Leads] DROP COLUMN [Name];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

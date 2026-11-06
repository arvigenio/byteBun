-- Split the lead's name into FirstName and LastName. Name stays as the full name.
-- Existing rows are split on the first space (no space: everything goes to FirstName).
-- The UPDATE and NOT NULL change run through sp_executesql because SQL Server checks column
-- names when the whole script is compiled, before the new columns exist.
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Leads] ADD [FirstName] NVARCHAR(50) NULL, [LastName] NVARCHAR(50) NULL;

-- Backfill
EXEC sp_executesql N'
UPDATE l SET
    [FirstName] = LEFT(CASE WHEN s.p = 0 THEN s.t ELSE LEFT(s.t, s.p - 1) END, 50),
    [LastName]  = LEFT(CASE WHEN s.p = 0 THEN N'''' ELSE LTRIM(SUBSTRING(s.t, s.p + 1, 4000)) END, 50)
FROM [dbo].[Leads] l
CROSS APPLY (SELECT LTRIM(RTRIM(l.[Name])) AS t) n
CROSS APPLY (SELECT n.t AS t, CHARINDEX(N'' '', n.t) AS p) s;';

EXEC sp_executesql N'ALTER TABLE [dbo].[Leads] ALTER COLUMN [FirstName] NVARCHAR(50) NOT NULL;';
EXEC sp_executesql N'ALTER TABLE [dbo].[Leads] ALTER COLUMN [LastName] NVARCHAR(50) NOT NULL;';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

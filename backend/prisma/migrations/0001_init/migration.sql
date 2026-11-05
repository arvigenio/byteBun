BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Leads] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [Name] NVARCHAR(120) NOT NULL,
    [Email] NVARCHAR(254) NOT NULL,
    [Phone] NVARCHAR(40),
    [BusinessName] NVARCHAR(160) NOT NULL,
    [BusinessType] NVARCHAR(80) NOT NULL,
    [Message] NVARCHAR(2000),
    [Source] NVARCHAR(50) NOT NULL CONSTRAINT [Leads_Source_df] DEFAULT 'website',
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Leads_CreatedAt_df] DEFAULT sysutcdatetime(),
    [Status] NVARCHAR(30) NOT NULL CONSTRAINT [Leads_Status_df] DEFAULT 'new',
    CONSTRAINT [Leads_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Leads_CreatedAt] ON [dbo].[Leads]([CreatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Leads_Email] ON [dbo].[Leads]([Email]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH


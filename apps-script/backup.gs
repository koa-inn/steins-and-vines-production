/**
 * Automated Backup System for Steins & Vines Spreadsheet
 *
 * This script creates nightly backups of the active spreadsheet and manages
 * retention to prevent unlimited backup accumulation.
 *
 * SETUP INSTRUCTIONS:
 * 1. Open the Google Spreadsheet
 * 2. Go to Extensions → Apps Script
 * 3. Create a new script file named "backup" (click + next to Files)
 * 4. Paste this entire file
 * 5. Run the setupBackupTrigger() function once to create the nightly trigger
 * 6. Authorize the script when prompted
 *
 * CONFIGURATION:
 * - BACKUP_FOLDER_NAME: Name of folder to store backups (created in same location as spreadsheet)
 * - RETENTION_DAYS: Number of days to keep backups (older ones are deleted)
 * - BACKUP_HOUR: Hour of day to run backup (0-23, in script timezone)
 *
 * MANUAL OPERATIONS:
 * - Run createBackup() manually to create an immediate backup
 * - Run cleanupOldBackups() to manually remove old backups
 * - Run deleteAllTriggers() to remove the scheduled backup trigger
 */

// ===== CONFIGURATION =====

var BACKUP_FOLDER_NAME = 'Steins-Vines-Backups';
var RETENTION_DAYS = 14;  // Keep backups for 2 weeks
var BACKUP_HOUR = 3;      // 3 AM in script timezone

// Set this to the Google Drive folder ID of the Steins & Vines Backup folder.
// Find it in the folder's URL: drive.google.com/drive/folders/FOLDER_ID_HERE
// If empty, backups are placed in the same folder as the spreadsheet (old behaviour).
var BACKUP_FOLDER_ID = '1c28ozHZTYHQ5N20zzyJuK40N8Ywiq188';

// ===== BACKUP FUNCTIONS =====

/**
 * Creates a backup copy of the active spreadsheet
 * Names the backup with timestamp: "Backup - YYYY-MM-DD HH:MM - [Original Name]"
 */
function createBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var originalName = ss.getName();
  var originalFile = DriveApp.getFileById(ss.getId());

  // Get or create backup folder
  var backupFolder = getOrCreateBackupFolder(originalFile);

  // Create timestamp for backup name
  var now = new Date();
  var timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var backupName = 'Backup - ' + timestamp + ' - ' + originalName;

  // Create the backup copy
  var backupFile = originalFile.makeCopy(backupName, backupFolder);

  // Log the backup
  Logger.log('Backup created: ' + backupName);
  Logger.log('Backup ID: ' + backupFile.getId());
  Logger.log('Backup URL: ' + backupFile.getUrl());

  // Clean up old backups after creating new one
  cleanupOldBackups();

  return {
    name: backupName,
    id: backupFile.getId(),
    url: backupFile.getUrl(),
    created: now.toISOString()
  };
}

/**
 * Gets the backup folder.
 * If BACKUP_FOLDER_ID is set, uses that folder directly.
 * Otherwise falls back to creating/finding a subfolder next to the spreadsheet.
 */
function getOrCreateBackupFolder(originalFile) {
  // Use the configured backup folder if an ID is provided
  if (BACKUP_FOLDER_ID) {
    return DriveApp.getFolderById(BACKUP_FOLDER_ID);
  }

  var parents = originalFile.getParents();
  var parentFolder;

  // Get the parent folder of the original file
  if (parents.hasNext()) {
    parentFolder = parents.next();
  } else {
    // If no parent (shouldn't happen), use root
    parentFolder = DriveApp.getRootFolder();
  }

  // Look for existing backup folder
  var folders = parentFolder.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }

  // Create new backup folder
  var backupFolder = parentFolder.createFolder(BACKUP_FOLDER_NAME);
  Logger.log('Created backup folder: ' + BACKUP_FOLDER_NAME);

  return backupFolder;
}

/**
 * Removes backups older than RETENTION_DAYS
 */
function cleanupOldBackups() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var originalFile = DriveApp.getFileById(ss.getId());
  var parents = originalFile.getParents();

  if (!parents.hasNext()) return;

  var parentFolder = parents.next();
  var folders = parentFolder.getFoldersByName(BACKUP_FOLDER_NAME);

  if (!folders.hasNext()) return;

  var backupFolder = folders.next();
  var files = backupFolder.getFiles();

  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  var deletedCount = 0;
  var keptCount = 0;

  while (files.hasNext()) {
    var file = files.next();
    var createdDate = file.getDateCreated();

    if (createdDate < cutoffDate) {
      Logger.log('Deleting old backup: ' + file.getName() + ' (created ' + createdDate + ')');
      file.setTrashed(true);
      deletedCount++;
    } else {
      keptCount++;
    }
  }

  Logger.log('Cleanup complete: ' + deletedCount + ' deleted, ' + keptCount + ' kept');
}

// ===== TRIGGER MANAGEMENT =====

/**
 * Sets up the nightly backup trigger
 * Run this function once to enable automated backups
 */
function setupBackupTrigger() {
  // First, remove any existing backup triggers to avoid duplicates
  deleteBackupTriggers();

  // Create new time-driven trigger for nightly backups
  ScriptApp.newTrigger('createBackup')
    .timeBased()
    .atHour(BACKUP_HOUR)
    .everyDays(1)
    .create();

  Logger.log('Backup trigger created: Daily at ' + BACKUP_HOUR + ':00');

  // Verify trigger was created
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'createBackup') {
      Logger.log('Trigger ID: ' + trigger.getUniqueId());
    }
  });

  return {
    success: true,
    message: 'Nightly backup scheduled for ' + BACKUP_HOUR + ':00',
    retentionDays: RETENTION_DAYS
  };
}

/**
 * Removes all backup-related triggers
 */
function deleteBackupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var deleted = 0;

  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'createBackup') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });

  Logger.log('Deleted ' + deleted + ' backup trigger(s)');
  return { deleted: deleted };
}

/**
 * Removes ALL triggers for this project (use with caution)
 */
function deleteAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = triggers.length;

  triggers.forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  Logger.log('Deleted all ' + count + ' trigger(s)');
  return { deleted: count };
}

// ===== STATUS & UTILITIES =====

/**
 * Lists all backups in the backup folder
 */
function listBackups() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var originalFile = DriveApp.getFileById(ss.getId());
  var parents = originalFile.getParents();

  if (!parents.hasNext()) {
    return { backups: [], folderExists: false };
  }

  var parentFolder = parents.next();
  var folders = parentFolder.getFoldersByName(BACKUP_FOLDER_NAME);

  if (!folders.hasNext()) {
    return { backups: [], folderExists: false };
  }

  var backupFolder = folders.next();
  var files = backupFolder.getFiles();
  var backups = [];

  while (files.hasNext()) {
    var file = files.next();
    backups.push({
      name: file.getName(),
      id: file.getId(),
      url: file.getUrl(),
      created: file.getDateCreated().toISOString(),
      size: file.getSize()
    });
  }

  // Sort by creation date (newest first)
  backups.sort(function(a, b) {
    return new Date(b.created) - new Date(a.created);
  });

  return {
    backups: backups,
    folderExists: true,
    folderUrl: backupFolder.getUrl(),
    totalCount: backups.length,
    retentionDays: RETENTION_DAYS
  };
}

/**
 * Gets the current backup configuration and trigger status
 */
function getBackupStatus() {
  var triggers = ScriptApp.getProjectTriggers();
  var backupTrigger = null;

  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'createBackup') {
      backupTrigger = {
        id: trigger.getUniqueId(),
        type: trigger.getEventType().toString()
      };
    }
  });

  var backupList = listBackups();

  return {
    triggerActive: backupTrigger !== null,
    trigger: backupTrigger,
    backupHour: BACKUP_HOUR,
    retentionDays: RETENTION_DAYS,
    backupFolderName: BACKUP_FOLDER_NAME,
    backupCount: backupList.totalCount || 0,
    latestBackup: backupList.backups && backupList.backups[0] ? backupList.backups[0] : null
  };
}

/**
 * Test function - creates a backup and logs the result
 */
function testBackup() {
  var result = createBackup();
  Logger.log('Test backup result: ' + JSON.stringify(result, null, 2));
  return result;
}

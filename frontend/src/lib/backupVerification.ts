/**
 * Secret backup verification utilities (Issue #791)
 * Helps users verify their backup before relying on it
 */

import { mnemonicToMasterSecret, masterSecretToMnemonic } from "./crypto";

export interface BackupVerificationResult {
  success: boolean;
  message: string;
  recoveredSecret?: string;
}

/**
 * Verify that a backed-up mnemonic can recover the original master secret
 */
export function verifyMnemonicBackup(
  originalMasterSecret: string,
  userEnteredMnemonic: string,
): BackupVerificationResult {
  try {
    const trimmed = userEnteredMnemonic.trim().toLowerCase();
    const words = trimmed.split(/\s+/);

    if (words.length !== 12) {
      return {
        success: false,
        message: `Expected 12 words, got ${words.length}. Please check your backup.`,
      };
    }

    // Derive master secret from entered mnemonic
    const recoveredSecret = mnemonicToMasterSecret(trimmed).toString();

    // Compare with original
    if (recoveredSecret === originalMasterSecret) {
      return {
        success: true,
        message: "Backup verified successfully! Your secret can be recovered.",
        recoveredSecret,
      };
    } else {
      return {
        success: false,
        message:
          "The entered mnemonic does not match your master secret. Please check your backup.",
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Verification failed: ${error.message}`,
    };
  }
}

/**
 * Generate a backup verification challenge
 * Returns a random word position (0-11) for the user to fill in
 */
export function generateVerificationChallenge(): number {
  return Math.floor(Math.random() * 12);
}

/**
 * Verify a single word from the mnemonic at a given position
 */
export function verifyWordAtPosition(
  masterSecret: string,
  position: number,
  userWord: string,
): boolean {
  try {
    const mnemonic = masterSecretToMnemonic(masterSecret);
    const words = mnemonic.split(" ");
    return words[position]?.toLowerCase() === userWord.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Check if localStorage backup exists
 */
export function hasLocalStorageBackup(): boolean {
  return localStorage.getItem("zkvote_hd_master_secret") !== null;
}

/**
 * Get backup age in milliseconds (if timestamp stored)
 */
export function getBackupAge(): number | null {
  const timestamp = localStorage.getItem("zkvote_backup_timestamp");
  if (!timestamp) return null;
  return Date.now() - parseInt(timestamp, 10);
}

/**
 * Mark backup as verified
 */
export function markBackupVerified(): void {
  localStorage.setItem("zkvote_backup_verified", "true");
  localStorage.setItem("zkvote_backup_verified_at", Date.now().toString());
}

/**
 * Check if backup has been verified
 */
export function isBackupVerified(): boolean {
  return localStorage.getItem("zkvote_backup_verified") === "true";
}

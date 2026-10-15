/**
 * Double-Entry Ledger Service (Issue #796)
 * Implements financial accounting for all money movements
 */

import type { Kysely } from "kysely";
import type { DB } from "../generated/db-types.js";

export interface JournalEntry {
  description: string;
  referenceType: "payment" | "swap" | "anchor_deposit" | "anchor_withdraw" | "reward" | "fee";
  referenceId: string;
  lines: JournalLine[];
}

export interface JournalLine {
  accountCode: string;
  debitStroops?: bigint;
  creditStroops?: bigint;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
}

export class LedgerService {
  constructor(private db: Kysely<DB>) {}

  /**
   * Post a balanced journal entry
   * Throws if debits != credits
   */
  async postEntry(entry: JournalEntry): Promise<bigint> {
    // Validate balance
    let totalDebits = 0n;
    let totalCredits = 0n;

    for (const line of entry.lines) {
      totalDebits += line.debitStroops || 0n;
      totalCredits += line.creditStroops || 0n;
    }

    if (totalDebits !== totalCredits) {
      throw new Error(
        `Unbalanced entry: debits=${totalDebits} credits=${totalCredits}`,
      );
    }

    // Begin transaction
    return await this.db.transaction().execute(async (trx) => {
      // Insert entry header
      const entryResult = await trx
        .insertInto("ledger_entries")
        .values({
          description: entry.description,
          reference_type: entry.referenceType,
          reference_id: entry.referenceId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const entryId = entryResult.id as bigint;

      // Resolve account IDs and insert lines
      for (const line of entry.lines) {
        const account = await trx
          .selectFrom("ledger_accounts")
          .select("id")
          .where("code", "=", line.accountCode)
          .executeTakeFirst();

        if (!account) {
          throw new Error(`Account not found: ${line.accountCode}`);
        }

        await trx
          .insertInto("ledger_lines")
          .values({
            entry_id: entryId,
            account_id: account.id,
            debit_stroops: line.debitStroops || 0n,
            credit_stroops: line.creditStroops || 0n,
            asset_code: line.assetCode || "XLM",
            asset_issuer: line.assetIssuer,
            memo: line.memo,
          })
          .execute();
      }

      return entryId;
    });
  }

  /**
   * Post a payment transaction
   * Debit: Relayer Float
   * Credit: Fee Revenue (fee portion) + DAO Treasury (amount portion)
   */
  async postPayment(params: {
    amountStroops: bigint;
    feeStroops: bigint;
    paymentHash: string;
    daoId?: number;
  }): Promise<bigint> {
    return this.postEntry({
      description: `Payment ${params.paymentHash}`,
      referenceType: "payment",
      referenceId: params.paymentHash,
      lines: [
        {
          accountCode: "1000", // Relayer Float (debit - asset decreases)
          creditStroops: params.amountStroops + params.feeStroops,
        },
        {
          accountCode: "1100", // DAO Treasury (credit - asset increases for recipient)
          debitStroops: params.amountStroops,
        },
        {
          accountCode: "4000", // Fee Revenue
          debitStroops: params.feeStroops,
        },
      ],
    });
  }

  /**
   * Post a swap transaction with slippage/dust accounting
   */
  async postSwap(params: {
    sourceAmountStroops: bigint;
    destAmountStroops: bigint;
    feeStroops: bigint;
    dustStroops: bigint;
    swapId: string;
  }): Promise<bigint> {
    return this.postEntry({
      description: `Swap ${params.swapId}`,
      referenceType: "swap",
      referenceId: params.swapId,
      lines: [
        {
          accountCode: "1000", // Relayer Float source (credit)
          creditStroops: params.sourceAmountStroops,
        },
        {
          accountCode: "1000", // Relayer Float dest (debit)
          debitStroops: params.destAmountStroops,
        },
        {
          accountCode: "5000", // Transaction Fees (expense)
          debitStroops: params.feeStroops,
        },
        {
          accountCode: "5100", // Dust Account (expense)
          debitStroops: params.dustStroops,
        },
      ],
    });
  }

  /**
   * Perform daily close - verify all entries balance
   */
  async performDailyClose(date: Date): Promise<boolean> {
    const result = await this.db
      .selectFrom("ledger_entries as e")
      .innerJoin("ledger_lines as l", "e.id", "l.entry_id")
      .select((eb) => [
        eb.fn.sum("l.debit_stroops").as("total_debits"),
        eb.fn.sum("l.credit_stroops").as("total_credits"),
      ])
      .where("e.entry_date", "=", date.toISOString().split("T")[0])
      .executeTakeFirst();

    const totalDebits = BigInt(result?.total_debits || 0);
    const totalCredits = BigInt(result?.total_credits || 0);
    const isBalanced = totalDebits === totalCredits;
    const discrepancy = totalDebits - totalCredits;

    await this.db
      .insertInto("ledger_daily_close")
      .values({
        close_date: date.toISOString().split("T")[0],
        total_debits: totalDebits,
        total_credits: totalCredits,
        balance_proof_hash: "", // TODO: Implement cryptographic proof
        is_balanced: isBalanced,
        discrepancy_stroops: discrepancy < 0n ? -discrepancy : discrepancy,
      })
      .execute();

    return isBalanced;
  }

  /**
   * Get account balance
   */
  async getAccountBalance(accountCode: string): Promise<bigint> {
    const result = await this.db
      .selectFrom("ledger_account_balances")
      .select("balance_stroops")
      .where("code", "=", accountCode)
      .executeTakeFirst();

    return result ? BigInt(result.balance_stroops) : 0n;
  }
}

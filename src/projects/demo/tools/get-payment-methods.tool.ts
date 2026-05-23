import type { AgentTool } from '../../../engine';
import { demoDb } from '../db/client';
import { paymentMethods } from '../db/schema';

export type PaymentMethod = {
  name: string | null;
  accountName: string | null;
  accountNumber: string | null;
  note: string | null;
};

export class GetPaymentMethodsTool implements AgentTool {
  readonly name = 'get_payment_methods';
  readonly description =
    'Fetch the full list of accepted payment methods (KBZ Pay, bank transfer, etc.). Columns: Name, Account Name, Account Number, Note. Call this when the customer asks how to pay, asks which payment methods are accepted, or is about to send a payment so the account details quoted match the source of truth.';
  readonly parameters = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  async execute(): Promise<PaymentMethod[]> {
    const rows = await demoDb.select().from(paymentMethods);
    return rows.map((r) => ({
      name: r.name,
      accountName: r.accountName,
      accountNumber: r.accountNumber,
      note: r.note,
    }));
  }
}

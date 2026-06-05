import { eq } from 'drizzle-orm';
import type { AgentTool } from '../../engine';
import { appDb } from '../db/client';
import { chats, orders } from '../db/schema';

export type CreateOrderToolOptions = {
  chatExtId: number;
};

export type CreateOrderResult = {
  id: number;
};

export class CreateOrderTool implements AgentTool {
  readonly name = 'create_order';
  readonly description =
    "Create an order for the current chat once the customer has agreed to proceed. Call this only after you have gathered every item listed in the chosen service's requirementsFromCustomer field, confirmed the price from get_services, and (when relevant) the payment method from get_payment_methods. The order is persisted against the current chat — do not ask the customer for their chat id.";
  readonly parameters = {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'Full order summary: chosen service, all requirements gathered from the customer, agreed price, and payment method if discussed.',
      },
    },
    required: ['summary'],
    additionalProperties: false,
  };

  constructor(private readonly opts: CreateOrderToolOptions) {}

  async execute(args: Record<string, unknown>): Promise<CreateOrderResult> {
    const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
    if (!summary) {
      throw new Error('create_order: summary is required');
    }

    const chatRow = await appDb
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.extId, this.opts.chatExtId))
      .limit(1);
    if (chatRow.length === 0) {
      throw new Error(
        `create_order: chat with extId ${this.opts.chatExtId} not found`,
      );
    }

    const inserted = await appDb
      .insert(orders)
      .values({ chatId: chatRow[0].id, summary })
      .returning({ id: orders.id });

    return { id: inserted[0].id };
  }
}

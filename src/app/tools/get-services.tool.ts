import type { AgentTool } from '../../engine';
import { appDb } from '../db/client';
import { services } from '../db/schema';

export type Service = {
  name: string;
  description: string;
  pricing: string;
  requirementsFromCustomer: string;
};

export class GetServicesTool implements AgentTool {
  readonly name = 'get_services';
  readonly description =
    'Fetch the full list of services available for sale. Columns: Service Name, Description, Pricing, Requirements From Customer. Call this when the user asks what services are offered, asks about pricing, or before quoting a price / calling create_order so the Service name matches the source of truth.';
  readonly parameters = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  async execute(): Promise<Service[]> {
    const rows = await appDb.select().from(services);
    return rows.map((r) => ({
      name: r.name,
      description: r.description,
      pricing: r.pricing,
      requirementsFromCustomer: r.requirementsFromCustomer,
    }));
  }
}

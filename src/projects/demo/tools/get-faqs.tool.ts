import type { AgentTool } from '../../../engine';
import { demoDb } from '../db/client';
import { fqas } from '../db/schema';

export type Faq = {
  question: string | null;
  answer: string | null;
};

export class GetFaqsTool implements AgentTool {
  readonly name = 'get_faqs';
  readonly description =
    "Fetch the full list of frequently asked questions and their answers. Columns: Question, Answer. Call this when the user asks a general question, asks for advice, or seems unsure — before answering from your own knowledge, check whether an FAQ entry already covers it and prefer the FAQ's answer when one matches.";
  readonly parameters = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  async execute(): Promise<Faq[]> {
    const rows = await demoDb.select().from(fqas);
    return rows.map((r) => ({
      question: r.question,
      answer: r.answer,
    }));
  }
}

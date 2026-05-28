// GENERATED FILE — DO NOT EDIT
// Imported and spread into server.ts's schemaMap.
import { z } from "zod";

export const schemas = {
  list_orders: z.object({ limit: z.number() }).strict(),
  get_order: z.object({ order_id: z.string() }).strict(),
  cancel_order: z.object({ order_id: z.string() }).strict(),
  refund_order: z.object({ order_id: z.string() }).strict(),
};

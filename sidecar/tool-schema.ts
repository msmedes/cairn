import { type TSchema, Type } from "@mariozechner/pi-ai";
import { type ZodType, z } from "zod";

export function toolSchemaFromZod<T>(
  schema: ZodType<T>,
): TSchema & { "~unsafe": T } {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });

  delete jsonSchema.$schema;

  return Type.Unsafe<T>(jsonSchema as TSchema);
}

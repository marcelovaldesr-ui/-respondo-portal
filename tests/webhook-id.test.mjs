import assert from "node:assert/strict";
import test from "node:test";

import { idEventoWebhook } from "../lib/webhookId.ts";

test("un reintento idéntico conserva la misma clave idempotente", () => {
  const payload = '{"entry":[{"id":"x"}]}';
  assert.equal(
    idEventoWebhook("meta_whatsapp", payload),
    idEventoWebhook("meta_whatsapp", payload),
  );
});

test("canal o cuerpo distinto no colisionan", () => {
  const payload = '{"entry":[{"id":"x"}]}';
  assert.notEqual(idEventoWebhook("meta_whatsapp", payload), idEventoWebhook("instagram", payload));
  assert.notEqual(idEventoWebhook("waha", payload), idEventoWebhook("waha", `${payload} `));
});

import assert from "node:assert/strict";
import test from "node:test";
import { esAdminRespondo } from "../lib/adminRespondo.ts";

test("solo correos listados en RESPONDO_ADMIN_EMAILS; sin variable, nadie (falla cerrado)", () => {
  assert.equal(esAdminRespondo("ops@respondo.cl", " Ops@Respondo.cl , otro@x.cl"), true);
  assert.equal(esAdminRespondo("dueno@negocio.cl", "ops@respondo.cl"), false);
  assert.equal(esAdminRespondo("ops@respondo.cl", ""), false);
  assert.equal(esAdminRespondo("ops@respondo.cl", undefined), false);
  assert.equal(esAdminRespondo("", "ops@respondo.cl"), false);
  assert.equal(esAdminRespondo("ops@respondo.cl.evil.com", "ops@respondo.cl"), false);
});

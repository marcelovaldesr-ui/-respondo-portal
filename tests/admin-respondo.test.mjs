import assert from "node:assert/strict";
import test from "node:test";
import { esAdminRespondo } from "../lib/adminRespondo.ts";

test("solo correos listados en RESPONDO_ADMIN_EMAILS; sin variable, nadie (falla cerrado)", () => {
  assert.equal(esAdminRespondo("ops@respon-do.com", " Ops@Respon-Do.com , otro@x.cl"), true);
  assert.equal(esAdminRespondo("dueno@negocio.cl", "ops@respon-do.com"), false);
  assert.equal(esAdminRespondo("ops@respon-do.com", ""), false);
  assert.equal(esAdminRespondo("ops@respon-do.com", undefined), false);
  assert.equal(esAdminRespondo("", "ops@respon-do.com"), false);
  assert.equal(esAdminRespondo("ops@respon-do.com.evil.com", "ops@respon-do.com"), false);
});

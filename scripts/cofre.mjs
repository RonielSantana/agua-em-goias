// Criptografia dos dados publicados. A senha vem da variável de ambiente SENHA_SITE (no GitHub, um
// segredo do repositório); ela nunca é gravada em arquivo.
// Formato de cada arquivo .bin: 12 bytes de IV + dados (JSON comprimido com gzip) cifrados com
// AES-256-GCM (a etiqueta de autenticação de 16 bytes fica no fim, como o navegador espera).
// A chave sai da senha por PBKDF2-SHA256. O sal é fixo por site, para que quem marcou
// "lembrar neste computador" continue entrando depois das atualizações semanais.
import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const SAL = Buffer.from("agua-em-goias/v1");
export const ITERACOES = 310000;
export const VERIFICADOR = "SISAGUA-OK";

export function chaveDaSenha(senha) {
  if (!senha || senha.length < 6) throw new Error("SENHA_SITE ausente ou curta demais (mínimo 6 caracteres).");
  return pbkdf2Sync(senha, SAL, ITERACOES, 32, "sha256");
}

export function cifra(chave, objeto) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const corpo = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(objeto)), { level: 9 })), c.final()]);
  return Buffer.concat([iv, corpo, c.getAuthTag()]);
}

export function decifra(chave, bytes) {
  const b = Buffer.from(bytes);
  const d = createDecipheriv("aes-256-gcm", chave, b.subarray(0, 12));
  d.setAuthTag(b.subarray(b.length - 16));
  return JSON.parse(gunzipSync(Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()])).toString("utf8"));
}

// Cifra site/dados/*.json → site/dados/*.bin com a senha de SENHA_SITE e apaga os .json,
// para que nenhum dado seja publicado aberto. Grava site/dados/chave.json (sal, iterações e um
// verificador cifrado, usado pelo painel para conferir a senha). Sem SENHA_SITE, para com erro.
// Uso: SENHA_SITE=... node scripts/criptografar.mjs
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ITERACOES, SAL, VERIFICADOR, chaveDaSenha, cifra, decifra } from "./cofre.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site", "dados");
const chave = chaveDaSenha(process.env.SENHA_SITE);
let n = 0;
for (const f of await readdir(dir)) {
  if (!f.endsWith(".json") || f === "chave.json") continue;
  const objeto = JSON.parse(await readFile(path.join(dir, f), "utf8"));
  const bin = cifra(chave, objeto);
  if (JSON.stringify(decifra(chave, bin)) !== JSON.stringify(objeto)) throw new Error("conferência da cifra falhou em " + f);
  await writeFile(path.join(dir, f.replace(/\.json$/, ".bin")), bin);
  await unlink(path.join(dir, f));
  n++;
}
const sobra = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "chave.json");
if (sobra.length) throw new Error("ainda há dados abertos: " + sobra.join(", "));
await writeFile(path.join(dir, "chave.json"), JSON.stringify({ sal: SAL.toString("base64"), iteracoes: ITERACOES, verificador: cifra(chave, VERIFICADOR).toString("base64") }));
console.log(`${n} arquivo(s) cifrado(s); nenhum dado aberto em site/dados.`);

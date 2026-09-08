#!/usr/bin/env python3
"""LA BRECHA ENTRE LOS DOS TROCEADORES (tarea #31) — ¿es fea o es GRAVE?

# Por que existe

Koru trocea el intel en dos sitios: `classifyIntel` (src/intel.ts), que alimenta la app, y
`analizar_intel` (src-tauri/src/commands.rs), que alimenta **la alarma y el overlay** — y que corre
en Rust a proposito, para que el aviso salte con la ventana minimizada.

El de Rust tiene la MISMA lista de jerga (198 palabras, comprobado) y **ninguno de los quince
mecanismos** que se le han ido anadiendo al de TS: abreviaturas de sistema, apodos y siglas de nave,
nombres en minuscula via `name_cache`, particulas, zonas, naves de varias palabras...

Sintoma que lo destapo, en una captura suya: el overlay decia **«hostil sin identificar»** donde la
app ya sacaba el nombre. Eso es feo pero es cosmetico. **Lo que hay que saber es si ademas hay
lineas en las que el vigilante NO ENCUENTRA EL SISTEMA — porque entonces no es que el aviso salga
feo: es que NO SUENA.**

# Que se mide, y que NO

Se mide desde el troceador BUENO, sin escribir un cuarto: para cada linea se mira si lo que
`classifyIntel` encontro estaba tambien al alcance del de Rust.

  · SISTEMA  → ¿hay algun token que case EXACTO con un sistema? Si no, salio de una abreviatura y
               el vigilante se queda sin sistema. **Esta es la cifra que decide la prioridad.**
  · PILOTO   → ¿empieza por mayuscula? Si no, salio de `name_cache` y el overlay dira «hostil sin
               identificar».
  · NAVE     → ¿casa exacta con el catalogo? Si no, salio de apodo, sigla, plural o prefijo.

⚠️ Es un SUELO, no un techo: el de Rust puede fallar ademas por cosas que esto no mira (particulas,
   digitos pegados, naves de varias palabras). Si ya el suelo es alto, sobra con eso para decidir.

⚠️ Solo LEE (`mode=ro`) y enmascara los codigos de null.

Uso: python scripts/audit_troceadores.py
     python scripts/audit_troceadores.py --limite 200000
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import sqlite3

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from audit_intel import enmascarar, ruta_bd  # noqa: E402

LIMITE = 0
if "--limite" in sys.argv:
    LIMITE = int(sys.argv[sys.argv.index("--limite") + 1])

MJS = r"""
import { readFileSync, writeFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [, , RAIZ, JSONL, CACHE, SALIDA] = process.argv;
const ruta = (...p) => join(RAIZ, ...p);
const ts = (await import(pathToFileURL(ruta("node_modules","typescript","lib","typescript.js")).href)).default;
const tp = (s) => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const M = await import("data:text/javascript;base64," + Buffer.from(tp(readFileSync(ruta("src","intel.ts"),"utf8"))).toString("base64"));
const ne = JSON.parse(readFileSync(ruta("public","neweden.json"),"utf8"));
const nameIdx = new Map(ne.systems.map((s) => [s.n.toLowerCase(), s]));
const zonaIdx = M.zonasDe(ne);
const shipNames = new Map([
  ...Object.entries(JSON.parse(readFileSync(ruta("public","ship_names_i18n.json"),"utf8"))),
  ...Object.entries(JSON.parse(readFileSync(ruta("public","ship_names.json"),"utf8"))),
]);
const cache = JSON.parse(readFileSync(CACHE, "utf8"));
const noExisten = new Set(Object.entries(cache).filter(([,v]) => v === -1).map(([k]) => k));
const existen = new Set(Object.entries(cache).filter(([,v]) => v === 1).map(([k]) => k));
const clean = (s) => s.replace(/[*.,;:!?()]+$/g, "").replace(/^[*([]+/g, "").trim();
const inc = (m,k,n=1) => m.set(k,(m.get(k)??0)+n);

let lineas = 0;
let conSistema = 0, sistemaSoloAbrev = 0;   // <- LA CIFRA QUE DECIDE: el vigilante no avisaria
let conPiloto = 0, pilotoSoloMinuscula = 0, algunPilotoMinuscula = 0;
let conNave = 0, naveNoExacta = 0;
const ejemplosMudos = new Map();            // sistema (nombre) -> veces que solo vino abreviado
const rl = createInterface({ input: createReadStream(JSONL,"utf8"), crlfDelay: Infinity });
for await (const l of rl) {
  if (!l.trim()) continue;
  const { texto } = JSON.parse(l);
  lineas++;
  const p = M.classifyIntel(texto, nameIdx, shipNames, noExisten, zonaIdx, existen);
  // Los tokens tal y como los ve el de Rust: parte por doble espacio y luego por espacios.
  const toks = M.limpiarMarcadoEve(texto).split(/\s+/).map(clean).filter(Boolean);
  const bajos = new Set(toks.map((t) => t.toLowerCase()));
  if (p.systems.length) {
    conSistema++;
    // ¿Alguno de los sistemas encontrados esta escrito ENTERO en la linea?
    const exacto = p.systems.some((s) => bajos.has(s.name.toLowerCase()));
    if (!exacto) {
      sistemaSoloAbrev++;
      inc(ejemplosMudos, p.systems[0].name);
    }
  }
  if (p.pilots.length) {
    conPiloto++;
    const min = p.pilots.filter((n) => !/^\p{Lu}/u.test(n.trim()));
    if (min.length) algunPilotoMinuscula++;
    if (min.length === p.pilots.length) pilotoSoloMinuscula++;
  }
  if (p.ships.length) {
    conNave++;
    if (p.ships.some((s) => !shipNames.has(s.name.toLowerCase()))) naveNoExacta++;
  }
}
const top = (m,n) => [...m].sort((a,b)=>b[1]-a[1]).slice(0,n);
writeFileSync(SALIDA, JSON.stringify({
  lineas, conSistema, sistemaSoloAbrev, conPiloto, pilotoSoloMinuscula, algunPilotoMinuscula,
  conNave, naveNoExacta, sistemasMudos: top(ejemplosMudos, 20),
}, null, 1), "utf8");
console.log(`  ${lineas.toLocaleString("es-ES")} lineas troceadas`);
"""


def main() -> int:
    ruta = ruta_bd()
    if not os.path.isfile(ruta):
        print(f"No encuentro la base de datos en:\n  {ruta}")
        return 1
    node = shutil.which("node")
    if not node:
        print("No encuentro `node` en el PATH.")
        return 1
    db = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    n = db.execute("SELECT COUNT(*) FROM intel_line").fetchone()[0]
    print(f"Base de datos: {ruta}")
    print(f"Lineas guardadas: {n:,}\n")

    tmp = tempfile.mkdtemp(prefix="koru-troc-")
    jsonl, cache_j, salida, mjs = (
        os.path.join(tmp, x) for x in ("lineas.jsonl", "cache.json", "out.json", "t.mjs")
    )
    with open(mjs, "w", encoding="utf-8") as f:
        f.write(MJS)
    sql = "SELECT texto FROM intel_line" + (f" LIMIT {LIMITE}" if LIMITE else "")
    with open(jsonl, "w", encoding="utf-8") as f:
        for (texto,) in db.execute(sql):
            f.write(json.dumps({"texto": texto}, ensure_ascii=False) + "\n")
    cache = {}
    for nl, cid in db.execute("SELECT name_lower, character_id FROM name_cache"):
        if cid is not None:
            cache[nl] = 1 if cid > 0 else -1
    with open(cache_j, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)

    r = subprocess.run([node, mjs, RAIZ, jsonl, cache_j, salida], capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print("Fallo:\n" + (r.stderr[-2000:] or "(sin salida)"))
        return 1
    with open(salida, encoding="utf-8") as f:
        d = json.load(f)
    shutil.rmtree(tmp, ignore_errors=True)

    pc = lambda a, b: f"{100*a/(b or 1):5.1f} %"
    print("\n" + "=" * 74)
    print("🚨 LO GRAVE: LINEAS EN LAS QUE EL VIGILANTE NO ENCONTRARIA EL SISTEMA")
    print("=" * 74)
    print(f"  lineas con sistema (troceador de la app)   {d['conSistema']:>10,}")
    print(f"  de esas, el sistema SOLO venia abreviado   {d['sistemaSoloAbrev']:>10,}"
          f"   {pc(d['sistemaSoloAbrev'], d['conSistema'])}")
    print("\n  El de Rust resuelve sistemas SOLO por nombre exacto. En esas lineas se queda sin")
    print("  sistema, y sin sistema no hay proximidad, ni alarma, ni overlay: **el aviso NO SUENA**.")
    print("  No es que salga feo. Es que no sale.")
    if d.get("sistemasMudos"):
        print("\n  Los sistemas que mas veces se quedan mudos (enmascarados):")
        for nom, c in d["sistemasMudos"]:
            print(f"    {c:>7,}  {enmascarar(nom)}")

    print("\n" + "=" * 74)
    print("LO COSMETICO: EL AVISO SUENA PERO SALE POBRE")
    print("=" * 74)
    print(f"  lineas con piloto                          {d['conPiloto']:>10,}")
    print(f"  con ALGUN piloto en minuscula              {d['algunPilotoMinuscula']:>10,}"
          f"   {pc(d['algunPilotoMinuscula'], d['conPiloto'])}")
    print(f"  con TODOS en minuscula -> «sin identificar»{d['pilotoSoloMinuscula']:>10,}"
          f"   {pc(d['pilotoSoloMinuscula'], d['conPiloto'])}")
    print(f"\n  lineas con nave                            {d['conNave']:>10,}")
    print(f"  con alguna nave que NO casa exacta         {d['naveNoExacta']:>10,}"
          f"   {pc(d['naveNoExacta'], d['conNave'])}")
    print("  (apodo, sigla, plural o prefijo: el vigilante no la nombraria)")

    print("\n" + "=" * 74)
    print("⚠️ ESTO ES UN SUELO, NO UN TECHO")
    print("=" * 74)
    print("  El de Rust puede fallar ademas por lo que esto NO mira: particulas dentro del nombre,")
    print("  digitos pegados, naves de varias palabras, el rotulo «Solar System», el marcado de")
    print("  enlaces del juego y las zonas. Si el suelo ya es alto, sobra para decidir.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

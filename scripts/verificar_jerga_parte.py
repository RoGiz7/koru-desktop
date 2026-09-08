#!/usr/bin/env python3
"""QUE CAMBIA DE VERDAD EN TU INTEL con el arreglo de la jerga que parte nombres.

# Por que existe

`audit_jerga_parte.py` mide el PROBLEMA. Esto mide el ARREGLO, sobre las mismas 827.356 lineas y
con el troceador ya cambiado: que avistamientos aparecen, cuales se sustituyen y cuales siguen
pendientes de que ESI conteste.

Existe porque una cifra de «cortes potenciales» no es una promesa: hasta que no se cuenta linea a
linea con el `name_cache` REAL, no se sabe cuanto se recupera hoy y cuanto hace falta preguntar.

  RECUPERADO YA  = la lectura larga ya esta confirmada -> el cambio se ve al reiniciar Koru.
  PENDIENTE      = la lectura larga esta propuesta y nadie ha preguntado -> lo arregla el boton
                   «Aprender nombres» de Ajustes -> Intel, en la misma tanda de siempre.

⚠️ Solo LEE (`mode=ro`) y enmascara los codigos de null. No escribe en `name_cache` ni pregunta a
   ESI: eso lo hace la app, a peticion suya.

Uso: python scripts/verificar_jerga_parte.py
     python scripts/verificar_jerga_parte.py --limite 200000
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
const inc = (m,k,n=1) => m.set(k,(m.get(k)??0)+n);
// sustituidos: la corta salia y ahora sale la larga · nuevos: hoy no salia NADIE
const sustituidos = new Map(), nuevos = new Map(), pendientes = new Map();
/** ★★ LA PRUEBA QUE SEPARA «apellido» de «sistema detras del nombre» (2026-09-08).
 *
 *  Los apellidos de EVE y los nombres de sistema salen del MISMO saco de lore, asi que «Torero
 *  Deninard» existe como personaje con mucha probabilidad **aunque esa linea quisiera decir
 *  «Torero, en Deninard»**. Que ESI diga «existe» no basta — es la trampa de `ess` otra vez.
 *
 *  Lo que si lo separa, y no cuesta ninguna peticion: **¿aparece el nombre CORTO por su cuenta en
 *  otras lineas?** Si «Torero» sale solo, en su campo, en sitios distintos, es una persona y
 *  «Deninard» de detras es el sistema. Si «BoneChilling» no aparece jamas sin «Chelien» al lado,
 *  entonces «BoneChilling Chelien» es su nombre entero.
 *
 *  `solo`      = veces que el corto sale como piloto SIN que se propusiera ninguna lectura larga.
 *  `sistemas`  = en cuantos sistemas distintos ha salido asi. Dos o mas = se mueve = es persona. */
const cortoSolo = new Map();        // corto (lc) -> veces
const cortoSistemas = new Map();    // corto (lc) -> Set de system_id
const parCorto = new Map();         // largo (lc) -> corto (lc), para cruzarlo al final
let lineas = 0, lineasTocadas = 0, propuestas = 0;
const rl = createInterface({ input: createReadStream(JSONL,"utf8"), crlfDelay: Infinity });
for await (const l of rl) {
  if (!l.trim()) continue;
  const { texto } = JSON.parse(l);
  lineas++;
  const p = M.classifyIntel(texto, nameIdx, shipNames, noExisten, zonaIdx, existen);
  // ★ Los pilotos que salen SIN que nadie proponga una lectura larga en esa linea: ahi el nombre
  //   corto esta actuando por su cuenta, que es justo la evidencia que hace falta.
  if (!p.pilotAlts.length) {
    for (const n of p.pilots) {
      const k = n.toLowerCase();
      inc(cortoSolo, k);
      if (!cortoSistemas.has(k)) cortoSistemas.set(k, new Set());
      for (const s of p.systems) cortoSistemas.get(k).add(s.id);
    }
    continue;
  }
  let tocada = false;
  for (const a of p.pilotAlts) {
    propuestas++;
    parCorto.set(a.largo.toLowerCase(), a.corto.toLowerCase());
    if (existen.has(a.largo.toLowerCase())) {
      // ¿la corta habria salido hoy? (no esta negada por ESI y tiene 3+ caracteres)
      const viva = !noExisten.has(a.corto.trim().toLowerCase()) && [...a.corto.trim()].length >= 3;
      // ⚠️ La clave lleva el corto SEPARADO por tabulador para poder cruzarlo despues con la
      //    prueba del `solo`. Sin eso el informe enseñaba la prueba solo de lo PENDIENTE y no de lo
      //    que YA se esta aplicando — que es justo donde un error ya esta hecho.
      inc(viva ? sustituidos : nuevos, `${a.corto}\t${a.largo}`);
      tocada = true;
    } else if (!noExisten.has(a.largo.toLowerCase())) {
      inc(pendientes, a.largo);
    }
  }
  if (tocada) lineasTocadas++;
}
const top = (m,n) => [...m].sort((a,b)=>b[1]-a[1]).slice(0,n);
/** Para cada nombre largo pendiente: cuanto vive el corto por su cuenta. */
const conPrueba = (pares) => pares.map(([largo, veces]) => {
  const c = parCorto.get(largo.toLowerCase()) ?? "";
  return [largo, veces, cortoSolo.get(c) ?? 0, (cortoSistemas.get(c)?.size ?? 0)];
});
/** Igual, para los pares YA aplicados (clave `corto \t largo`). */
const conPruebaPar = (pares) => pares.map(([k, veces]) => {
  const [corto, largo] = k.split("\t");
  const c = corto.toLowerCase();
  return [corto, largo, veces, cortoSolo.get(c) ?? 0, (cortoSistemas.get(c)?.size ?? 0)];
});
writeFileSync(SALIDA, JSON.stringify({
  lineas, lineasTocadas, propuestas,
  recuperadosYa: [...sustituidos.values()].reduce((a,b)=>a+b,0) + [...nuevos.values()].reduce((a,b)=>a+b,0),
  sustituidos: conPruebaPar(top(sustituidos, 50)), nuevos: conPruebaPar(top(nuevos, 50)),
  // Los que YA se aplican y encima el corto se mueve por ahi: la lista a revisar de verdad.
  sospechosos: conPruebaPar([...sustituidos, ...nuevos].sort((a,b)=>b[1]-a[1]))
    .filter((x) => x[4] >= 2 && x[3] >= 10),
  pendientesTotal: [...pendientes.values()].reduce((a,b)=>a+b,0),
  pendientesDistintos: pendientes.size,
  pendientes: conPrueba(top(pendientes, 60)),
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

    tmp = tempfile.mkdtemp(prefix="koru-verif-")
    jsonl, cache_j, salida, mjs = (
        os.path.join(tmp, x) for x in ("lineas.jsonl", "cache.json", "out.json", "v.mjs")
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

    print("\n" + "=" * 74)
    print("QUE CAMBIA HOY, SIN PREGUNTAR NADA A ESI")
    print("=" * 74)
    print(f"  lecturas largas propuestas          {d['propuestas']:>10,}")
    print(f"  avistamientos que cambian YA        {d['recuperadosYa']:>10,}")
    print(f"  lineas afectadas                    {d['lineasTocadas']:>10,}")
    print("\n  solo = veces que el nombre CORTO sale por su cuenta (sin lectura larga)")
    print("  sis  = en cuantos sistemas distintos ha salido asi")
    print("  ⚠️ `solo` alto y `sis` > 1 = ese corto SE MUEVE, o sea que es la persona y lo de detras")
    print("     es el sistema. Ahi la lectura larga es un nombre INVENTADO, aunque ESI diga que")
    print("     existe alguien asi: «existe» no es «es esto».")
    print("\n  --- NOMBRES QUE SE ARREGLAN (la corta salia mal, ahora sale la larga) ---")
    print(f"  {'veces':>7} {'solo':>7} {'sis':>5}  cambio")
    for corto, largo, c, solo, sis in d["sustituidos"]:
        print(f"  {c:>7,} {solo:>7,} {sis:>5,}  {enmascarar(corto)}  ->  {enmascarar(largo)}")
    print("\n  --- PERSONAS QUE HOY NO EXISTIAN PARA KORU (no salia NADIE en esa linea) ---")
    print(f"  {'veces':>7} {'solo':>7} {'sis':>5}  cambio")
    for corto, largo, c, solo, sis in d["nuevos"]:
        print(f"  {c:>7,} {solo:>7,} {sis:>5,}  {enmascarar(corto)}  ->  {enmascarar(largo)}")

    sos = d.get("sospechosos") or []
    print("\n" + "=" * 74)
    print("🚨 YA APLICADOS Y SOSPECHOSOS  (el corto sale solo 10+ veces en 2+ sistemas)")
    print("=" * 74)
    if not sos:
        print("  Ninguno. Todos los cambios aplicados son de nombres que NO viven por su cuenta.")
    else:
        print(f"  {len(sos)} pares. Si estos estan mal, es un nombre INVENTADO en tus avistamientos.")
        print(f"  {'veces':>7} {'solo':>7} {'sis':>5}  cambio")
        for corto, largo, c, solo, sis in sos[:40]:
            print(f"  {c:>7,} {solo:>7,} {sis:>5,}  {enmascarar(corto)}  ->  {enmascarar(largo)}")

    print("\n" + "=" * 74)
    print("LO QUE FALTA POR PREGUNTAR  (boton «Aprender nombres», Ajustes -> Intel)")
    print("=" * 74)
    print(f"  nombres largos distintos sin veredicto: {d['pendientesDistintos']:,}")
    print(f"  apariciones que dependen de ello:       {d['pendientesTotal']:,}")
    print("  ⚠️ De estos, ESI dira que NO a bastantes («keep eye», «night's Watch»), y eso tambien")
    print("     es un resultado: se guarda el «no» y no se vuelve a proponer nunca mas.")
    print()
    print("  ★ LA PRUEBA QUE NO CUESTA PETICIONES — porque «existe» no es «es esto»:")
    print("    solo = veces que el nombre CORTO sale por su cuenta, sin ninguna lectura larga")
    print("    sis  = en cuantos sistemas distintos ha salido asi")
    print("    Si `solo` es alto y `sis` > 1, el corto SE MUEVE: es la persona, y lo de detras es")
    print("    el sistema. Si `solo` = 0, el corto no existe fuera de ese par: el largo es su nombre.")
    print(f"  {'veces':>7} {'solo':>7} {'sis':>5}  nombre largo propuesto")
    for fila in d["pendientes"]:
        k, c = fila[0], fila[1]
        solo, sis = (fila[2], fila[3]) if len(fila) > 3 else (0, 0)
        print(f"  {c:>7,} {solo:>7,} {sis:>5,}  {enmascarar(k)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

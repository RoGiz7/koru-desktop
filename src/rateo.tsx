// Sección PvE · Rateo: ISK por bounties con granularidad/rango, por sistema o personaje, ratas
// especiales y papeles de Abyssals/CRAB. Extraído de App.tsx. PapersBlock es interno (solo Rateo).
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadNewEden } from "./neweden";
import { tr } from "./i18n";
import { fmtIsk, fmtSp, typeIcon, weekKey, daysAgo } from "./format";
import { Kpi, MultiLineProgress, DONUT_COLORS, RangePresets } from "./charts";
import type {
  RattingDetail,
  SpecialRatsResult,
  PaperSeries,
  AbyssalsData,
  GamelogRecon,
  WeaponDay,
  QualityDay,
  SalvageDay,
  DpsDay,
} from "./types";

// Cabecera de tabla ordenable reutilizable. Click → ordena por esa columna; reclick → invierte.
export function RateoView({
  data,
  special,
  charNames,
  paperSeries,
  abyssals,
  busy,
  subject,
  glTick,
}: {
  data: RattingDetail | null;
  special: SpecialRatsResult | null;
  charNames: Map<number, string>;
  paperSeries: PaperSeries | null;
  abyssals: AbyssalsData | null;
  busy: boolean;
  subject?: number | "global";
  /// Latido de App: sube al completar un escaneo de gamelogs → las series del log se refrescan solas.
  glTick?: number;
}) {
  // Fusión visual (opt-in): serie diaria del bounty reconstruido del gamelog (fuente SEPARADA).
  const [glBounty, setGlBounty] = useState<{ date: string; value: number }[]>([]);
  // Fase D — bruto por sistema desde el gamelog (2019→), y qué parte del bruto total representa.
  const [glSys, setGlSys] = useState<Map<string, { isk: number; pays: number }>>(new Map());
  const [glSysCov, setGlSysCov] = useState(0);
  const [showGl, setShowGl] = useState(() => localStorage.getItem("koru-rateo-gl") === "1");
  useEffect(() => {
    localStorage.setItem("koru-rateo-gl", showGl ? "1" : "0");
  }, [showGl]);
  useEffect(() => {
    const sid = typeof subject === "number" ? subject : 0;
    invoke<GamelogRecon>("get_gamelog_recon", { subjectId: sid })
      .then((r) => {
        setGlBounty(r.bounty_series);
        setGlSys(new Map((r.sys_bounty ?? []).map((s) => [s.system, { isk: s.isk, pays: s.pays }])));
        setGlSysCov(r.bounty_isk > 0 ? r.sys_bounty_covered / r.bounty_isk : 0);
      })
      .catch(() => {
        setGlBounty([]);
        setGlSys(new Map());
        setGlSysCov(0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, glTick]);
  // Qué MAGNITUD pinta la gráfica. Mezclar ISK (miles de millones) con nº de ratas (miles) en el
  // mismo eje obliga a normalizar, y normalizar es maquillar. Se cambia de magnitud, no de escala.
  // `dmg` y `miss` salen del gamelog (por arma/dron, todo el histórico); `rats` e `iskrat` salen del
  // `reason` de ESI. Nunca en el mismo eje: son cosas distintas medidas por fuentes distintas.
  // `spec` va aparte y no dentro de `rats`: nueve especiales contra cuatro mil ratas normales, en el
  // mismo eje, son una línea plana pegada al cero. No se normaliza una escala; se cambia de magnitud.
  type Mag = "isk" | "rats" | "iskrat" | "spec" | "dmg" | "miss" | "qual" | "salv" | "dps";
  const [mag, setMag] = useState<Mag>(() => (localStorage.getItem("koru-rateo-mag") as Mag) || "isk");
  const [glWeapons, setGlWeapons] = useState<WeaponDay[]>([]);
  // Calidad del golpe (1..6) y salvage: v18, del gamelog, todo el histórico. Cuentas, no ISK.
  const [glQuality, setGlQuality] = useState<QualityDay[]>([]);
  const [glSalvage, setGlSalvage] = useState<SalvageDay[]>([]);
  // DPS (gamelog): daño/segundos ACTIVOS por día + mejor segundo. Los datos existen desde v15;
  // hasta ahora solo asomaban en Reconstrucción como KPI.
  const [glDps, setGlDps] = useState<DpsDay[]>([]);
  // Dirección de la calidad: tus golpes o los que recibes. En los recibidos el arma falta a menudo,
  // pero la CALIDAD sí está: la distribución es igual de real en ambos sentidos.
  const [qdir, setQdir] = useState<"done" | "taken">(
    () => (localStorage.getItem("koru-rateo-qdir") as "done" | "taken") || "done",
  );
  useEffect(() => {
    localStorage.setItem("koru-rateo-qdir", qdir);
  }, [qdir]);
  useEffect(() => {
    const sid = typeof subject === "number" ? subject : 0;
    invoke<WeaponDay[]>("get_gamelog_weapons", { subjectId: sid })
      .then(setGlWeapons)
      .catch(() => setGlWeapons([]));
    invoke<QualityDay[]>("get_gamelog_quality", { subjectId: sid })
      .then(setGlQuality)
      .catch(() => setGlQuality([]));
    invoke<SalvageDay[]>("get_gamelog_salvage", { subjectId: sid })
      .then(setGlSalvage)
      .catch(() => setGlSalvage([]));
    invoke<DpsDay[]>("get_gamelog_dps", { subjectId: sid })
      .then(setGlDps)
      .catch(() => setGlDps([]));
    // glTick: acabar un escaneo refresca armas/calidad/salvage/DPS sin salir de la vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, glTick]);
  useEffect(() => {
    localStorage.setItem("koru-rateo-mag", mag);
  }, [mag]);
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">(
    () => (localStorage.getItem("koru-rateo-gran") as "day" | "week" | "month" | "year") || "day",
  );
  const cumulative: boolean = false; // "Acumulado" retirado; los presets de rango lo sustituyen.
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState("");
  const [dim, setDim] = useState<"sys" | "char">(
    () => (localStorage.getItem("koru-rateo-dim") as "sys" | "char") || "sys",
  );
  const [names, setNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    localStorage.setItem("koru-rateo-gran", gran);
  }, [gran]);
  useEffect(() => {
    localStorage.setItem("koru-rateo-dim", dim);
  }, [dim]);

  useEffect(() => {
    loadNewEden()
      .then((ne) => setNames(new Map(ne.systems.map((s) => [s.id, s.n]))))
      .catch(() => {});
  }, []);

  if (!data)
    return (
      <>
        <p className="muted">{busy ? tr("Cargando…") : tr("Sin datos.")}</p>
        <PapersBlock series={paperSeries} data={abyssals} />
      </>
    );
  if (data.entries === 0)
    return (
      <>
        <p className="muted small">
          {tr("Sin ingresos de rateo en el journal. Sincroniza la wallet del personaje (sección Wallet) para empezar a acumular el histórico en tu PC.")}
        </p>
        <PapersBlock series={paperSeries} data={abyssals} />
      </>
    );

  const sysName = (id: number) => names.get(id) ?? `#${id}`;
  const granLabel =
    gran === "day" ? tr("día") : gran === "week" ? tr("semana") : gran === "month" ? tr("mes") : tr("año");

  // Filtra por rango de fechas (YYYY-MM-DD) y agrupa por granularidad.
  const daily = data.daily.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  const bucketKey = (date: string) =>
    gran === "year"
      ? date.slice(0, 4)
      : gran === "month"
        ? date.slice(0, 7)
        : gran === "week"
          ? weekKey(date)
          : date;
  const buckets = new Map<string, { isk: number; rats: number }>();
  for (const d of daily) {
    const k = bucketKey(d.date);
    const e = buckets.get(k) ?? { isk: 0, rats: 0 };
    e.isk += d.bounty + d.ess;
    e.rats += d.rats;
    buckets.set(k, e);
  }
  let series = [...buckets.entries()].map(([label, v]) => ({ label, isk: v.isk, rats: v.rats }));
  if (cumulative) {
    let accI = 0;
    let accR = 0;
    series = series.map((s) => ({ ...s, isk: (accI += s.isk), rats: (accR += s.rats) }));
  }

  // KPIs del RANGO seleccionado (no del histórico entero) → más fiel a "lo de ahora".
  const rangeBounty = daily.reduce((a, d) => a + d.bounty, 0);
  const rangeEss = daily.reduce((a, d) => a + d.ess, 0);
  const rangeRats = daily.reduce((a, d) => a + d.rats, 0);
  const rangeGross = daily.reduce((a, d) => a + d.gross, 0);
  const totalIsk = rangeBounty + rangeEss;
  // Total histórico (para el % del "Detalle por sistema", que sigue siendo all-time por datos).
  const allTimeIsk = data.total_bounty + data.total_ess;
  // ISK/hora estimado: escala las horas activas totales por la fracción de días activos en el rango.
  const totalActiveDays = data.daily.filter((d) => d.bounty + d.ess > 0).length;
  const rangeActiveDays = daily.filter((d) => d.bounty + d.ess > 0).length;
  const rangeHours =
    totalActiveDays > 0 ? (data.active_hours * rangeActiveDays) / totalActiveDays : 0;
  const iskPerHour = rangeHours > 0 ? totalIsk / rangeHours : 0;
  const rateoYears = [...new Set(data.daily.map((d) => +d.date.slice(0, 4)))].sort((a, b) => b - a);
  const topSystems = data.by_system.slice(0, 12);
  // Sistemas que SOLO conoce el gamelog: rateaste ahí antes de que arrancara tu histórico de wallet.
  const esiSysNames = new Set(data.by_system.map((s) => sysName(s.system_id)));
  const glOnlySystems = [...glSys.entries()]
    .filter(([n]) => !esiSysNames.has(n))
    .sort((a, b) => b[1].isk - a[1].isk)
    .slice(0, 12);
  // Cuánto del COBRADO lleva sistema. El wallet solo sabe el sistema por el `context_id` de ESI, y las
  // filas importadas del CSV de corptools no lo traen. Sin este dato, poner la columna ISK al lado del
  // Bruto invita a una conclusión falsa: parecería que solo cobraste el 10% de lo que valían las ratas,
  // cuando lo que pasa es que el 90% del cobrado no está atribuido a ningún sistema.
  const esiSysIsk = data.by_system.reduce((a, s) => a + s.isk, 0);
  const esiSysCov = allTimeIsk > 0 ? esiSysIsk / allTimeIsk : 0;

  // Fusión opcional con el gamelog: bucketea el bounty reconstruido igual que la serie ESI.
  const glDaily = glBounty.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  const glBk = new Map<string, number>();
  for (const d of glDaily) {
    const k = bucketKey(d.date);
    glBk.set(k, (glBk.get(k) ?? 0) + d.value);
  }
  const glOn = showGl && glBk.size > 0;
  // Eje X = unión de fechas ESI ∪ gamelog cuando la línea está activa (para ver el histórico extra).
  // Series por sistema (top 6) alineadas con los mismos buckets.
  const labels = glOn
    ? [...new Set([...series.map((s) => s.label), ...glBk.keys()])].sort()
    : series.map((s) => s.label);
  // Lo que ESI ve entrar en la wallet, en sus DOS piezas. No dibujamos su suma: sería una tercera
  // línea que no aporta nada y que además invitaba a restarla contra el gamelog (ver más abajo).
  // El bounty entra ya recortado por el ESS; el ESS te lo devuelve —o no— más tarde y por su cuenta.
  const bkBounty = new Map<string, number>();
  const bkEss = new Map<string, number>();
  const bkGross = new Map<string, number>(); // precio de las ratas, del `reason` de ESI
  const bkRats = new Map<string, number>();
  for (const d of daily) {
    const k = bucketKey(d.date);
    bkBounty.set(k, (bkBounty.get(k) ?? 0) + d.bounty);
    bkEss.set(k, (bkEss.get(k) ?? 0) + d.ess);
    bkGross.set(k, (bkGross.get(k) ?? 0) + d.gross);
    bkRats.set(k, (bkRats.get(k) ?? 0) + d.rats);
  }
  const bountyLine = { name: tr("Bounty en wallet"), color: "#5b9bd1", values: labels.map((l) => bkBounty.get(l) ?? 0) };
  const essLine = { name: tr("Pagos del ESS"), color: "#57c785", values: labels.map((l) => bkEss.get(l) ?? 0) };
  // Total de lo cobrado. Se calcula SUMANDO las dos líneas de arriba, no releyendo la BD: así es
  // imposible que se descuadre con lo que se está pintando. No es una hipótesis, es un agregado
  // exacto y verificable a ojo. (Distinto del antiguo "Total", contra el que llegué a restar cosas.)
  const cobradoLine = {
    name: tr("Total cobrado (wallet)"),
    color: "#c8d3df",
    values: bountyLine.values.map((v, i) => v + essLine.values[i]),
  };
  const sysBuckets = new Map<number, Map<string, number>>();
  for (const r of data.daily_by_system) {
    if ((from && r.date < from) || (to && r.date > to)) continue;
    const k = bucketKey(r.date);
    let m = sysBuckets.get(r.system_id);
    if (!m) {
      m = new Map();
      sysBuckets.set(r.system_id, m);
    }
    m.set(k, (m.get(k) ?? 0) + r.isk);
  }
  const sysVals = (sysId: number) => {
    const m = sysBuckets.get(sysId);
    let acc = 0;
    return labels.map((lab) => {
      const v = m?.get(lab) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const sysLineSeries = [
    cobradoLine,
    bountyLine,
    essLine,
    ...data.by_system.slice(0, 6).map((s, i) => ({
      name: sysName(s.system_id),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: sysVals(s.system_id),
    })),
  ];

  // Series por PERSONAJE (quién aporta más ISK). Solo útil en global (varios pj).
  const charBuckets = new Map<number, Map<string, number>>();
  for (const r of data.daily_by_char) {
    if ((from && r.date < from) || (to && r.date > to)) continue;
    const k = bucketKey(r.date);
    let m = charBuckets.get(r.character_id);
    if (!m) {
      m = new Map();
      charBuckets.set(r.character_id, m);
    }
    m.set(k, (m.get(k) ?? 0) + r.isk);
  }
  const charTotals = [...charBuckets.entries()]
    .map(([id, m]) => ({ id, total: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const charVals = (id: number) => {
    const m = charBuckets.get(id);
    let acc = 0;
    return labels.map((lab) => {
      const v = m?.get(lab) ?? 0;
      return cumulative ? (acc += v) : v;
    });
  };
  const charLineSeries = [
    cobradoLine,
    bountyLine,
    essLine,
    ...charTotals.slice(0, 8).map((c, i) => ({
      name: charNames.get(c.id) ?? `#${c.id}`,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      values: charVals(c.id),
    })),
  ];
  const multiChar = charTotals.length > 1; // solo ofrecer "por personaje" si hay varios
  const baseLines = dim === "char" && multiChar ? charLineSeries : sysLineSeries;

  // Las dos fuentes miden cosas DISTINTAS y no se empalman:
  //  · ESI = lo que entró en la wallet (bounty ya recortado por el ESS, + los pagos del ESS cobrados).
  //  · gamelog = el bounty BRUTO que generó el piloto al matar la rata, antes de que nadie lo toque.
  // Su diferencia es lo que se quedó por el camino: corte del ESS no cobrado, robos e impuestos.
  // Solo tiene sentido donde ESI tiene datos; antes de su ventana, "cobrado" es 0 y la resta mentiría.
  const glVals = labels.map((l) => glBk.get(l) ?? 0);
  // Es el VALOR de la rata al matarla, no un cobro. Por eso no se llama "generado" ni "cobrado": no
  // compite con las otras dos líneas ni se resta contra ellas. Se sostiene sola.
  // "(gamelog)" explícito: en la leyenda convivía con "Precio bounty de ratas (ESI)" y las dos líneas
  // se pisan a propósito donde ambas existen. Sin la etiqueta, parecen la misma serie duplicada.
  const glLine = { name: tr("Precio bounty de ratas (gamelog)"), color: "#e0a458", values: glVals, dash: true };

  // Lo que valían las ratas y nunca llegó a tu wallet: impuesto de corp, ESS que no cobraste y robos.
  // Se dibuja NEGATIVO: es dinero que no vas a recibir, y pintarlo positivo lo confundiría con ingreso.
  //
  // CANDADO: solo desde el primer bucket en que ESI conoce pagos del ESS. Antes de eso el export de
  // corptools no trae `ess_escrow_transfer` (cero filas en 2023 y 2024), así que "lo cobrado" saldría
  // artificialmente bajo y la resta inventaría una retención enorme que no existió. Medido en meses
  // con datos completos, lo que falta es ~15% estable; con el candado abierto salía ~45%. Falso.
  const essStart = labels.find((l) => (bkEss.get(l) ?? 0) > 0) ?? null;
  const lostVals = labels.map((l, i) =>
    essStart != null && l >= essStart && glVals[i] > 0 ? cobradoLine.values[i] - glVals[i] : 0,
  );
  const lostLine = {
    name: tr("No ingresado (impuestos, ESS y robos)"),
    color: "#d76a6a",
    values: lostVals,
    dash: true,
  };
  const hasLost = lostVals.some((v) => v !== 0);
  // NO dibujamos una línea de "no ingresado" (= cobrado − gamelog). Se probó y era falsa por tres
  // motivos, comprobados sobre datos reales:
  //   1. Daba por hecho que el log es el bounty BRUTO. Pero en los meses con ESI completo, el
  //      `bounty_prizes` de la wallet coincide con el log → el log NO es pre-ESS.
  //   2. Daba por hecho que ESI está completo. El export de corptools no trae NINGÚN
  //      `ess_escrow_transfer` antes de 2025, así que "lo cobrado" salía artificialmente bajo y la
  //      resta inventaba una retención que no existía.
  //   3. Los pagos del ESS llegan desplazados (banco cada 3 h), así que restarlos dentro del mismo
  //      bucket mezcla meses distintos.
  // Mostramos las tres magnitudes por separado y que el ojo compare. Cuando sepamos con certeza qué
  // mide el log, se podrá derivar la retención — no antes.
  // Precio de las ratas SEGÚN ESI: Σ(cantidad × valor) del desglose del pago. No se empalma con la
  // del gamelog: se SUPERPONEN. Donde ambas existen deben pisarse — y si no, hay un bug. Esa
  // redundancia dibujada es un test de regresión permanente, así que no la escondemos.
  const grossVals = labels.map((l) => bkGross.get(l) ?? 0);
  const grossLine = { name: tr("Precio bounty de ratas (ESI)"), color: "#d29922", values: grossVals };
  const hasGross = grossVals.some((v) => v > 0);

  // El nº de ratas sale del `reason` de cada pago, y ESI solo sirve el journal reciente: todo lo que
  // importaste del CSV de corptools viene SIN `reason`. Fuera de esa ventana no hay dato — y un cero
  // dibujado diría "no mataste ninguna rata", que es falso. Así que el eje se recorta a la ventana
  // donde el dato existe, en vez de rellenar seis años de ceros.
  const ratsWindow = labels.filter((l) => (bkRats.get(l) ?? 0) > 0);
  const ratsFrom = ratsWindow[0];
  const ratsTo = ratsWindow[ratsWindow.length - 1];
  const ratsScoped = (mag === "rats" || mag === "iskrat" || mag === "spec") && ratsFrom !== undefined;
  // El gamelog tiene su propio eje: cubre desde 2019, mucho más que la ventana de ESI.
  const wpLabels = [
    ...new Set(
      glWeapons
        .filter((w) => (!from || w.date >= from) && (!to || w.date <= to))
        .map((w) => bucketKey(w.date)),
    ),
  ].sort();
  // Calidad y salvage: mismo origen (gamelog) y por tanto su propio eje, como Daño/Fallos.
  const qlLabels = [
    ...new Set(
      glQuality
        .filter((q) => (!from || q.date >= from) && (!to || q.date <= to))
        .map((q) => bucketKey(q.date)),
    ),
  ].sort();
  const svLabels = [
    ...new Set(
      glSalvage
        .filter((s) => (!from || s.date >= from) && (!to || s.date <= to))
        .map((s) => bucketKey(s.date)),
    ),
  ].sort();
  const dpLabels = [
    ...new Set(
      glDps
        .filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
        .map((d) => bucketKey(d.date)),
    ),
  ].sort();
  const chartLabels =
    mag === "dmg" || mag === "miss"
      ? wpLabels
      : mag === "qual"
        ? qlLabels
        : mag === "salv"
          ? svLabels
          : mag === "dps"
            ? dpLabels
            : ratsScoped
              ? labels.filter((l) => l >= ratsFrom && l <= ratsTo)
              : labels;
  const cobradoBk = new Map(labels.map((l, i) => [l, cobradoLine.values[i]]));

  const ratsVals = chartLabels.map((l) => bkRats.get(l) ?? 0);
  const ratsLine = { name: tr("Ratas muertas"), color: "#a371f7", values: ratsVals };
  // Especiales: mismo origen (el `reason` de ESI) y por tanto misma ventana que "Ratas muertas". Van
  // en el mismo eje porque son un SUBCONJUNTO de esas ratas, no otra magnitud.
  const bkSpec = { officers: new Map<string, number>(), capitals: new Map<string, number>(), faction: new Map<string, number>() };
  for (const d of special?.daily ?? []) {
    if ((from && d.date < from) || (to && d.date > to)) continue;
    const k = bucketKey(d.date);
    bkSpec.officers.set(k, (bkSpec.officers.get(k) ?? 0) + d.officers);
    bkSpec.capitals.set(k, (bkSpec.capitals.get(k) ?? 0) + d.capitals);
    bkSpec.faction.set(k, (bkSpec.faction.get(k) ?? 0) + d.faction);
  }
  const specLines = (
    [
      ["Oficiales", "#f0883e", bkSpec.officers],
      ["Capitales", "#e5534b", bkSpec.capitals],
      ["Faction", "#d29922", bkSpec.faction],
    ] as const
  )
    .map(([name, color, m]) => ({ name: tr(name), color, values: chartLabels.map((l) => m.get(l) ?? 0) }))
    .filter((s) => s.values.some((v) => v > 0));

  // ---- Armas y drones (gamelog). Daño hecho y fallos, por arma. No dice qué mató a la rata: el
  // gamelog no registra muertes, solo golpes. Cubre TODO el histórico, no solo la ventana de ESI.
  const wpAgg = (pick: (w: WeaponDay) => number) => {
    const m = new Map<string, Map<string, number>>();
    for (const w of glWeapons) {
      if ((from && w.date < from) || (to && w.date > to)) continue;
      const v = pick(w);
      if (v <= 0) continue;
      const k = bucketKey(w.date);
      let mm = m.get(w.weapon);
      if (!mm) {
        mm = new Map();
        m.set(w.weapon, mm);
      }
      mm.set(k, (mm.get(k) ?? 0) + v);
    }
    return m;
  };
  const wpLines = (m: Map<string, Map<string, number>>) =>
    [...m.entries()]
      .map(([weapon, mm]) => ({ weapon, mm, total: [...mm.values()].reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total)
      .map((s, i) => ({
        name: s.weapon,
        color: i < DONUT_COLORS.length ? DONUT_COLORS[i] : `hsl(${(i * 137.5) % 360} 62% 62%)`,
        values: wpLabels.map((l) => s.mm.get(l) ?? 0),
      }));
  const dmgLines = wpLines(wpAgg((w) => w.dmg));
  const missLines = wpLines(wpAgg((w) => w.misses));

  // ---- Calidad del golpe (gamelog): seis escalones, de Roza a Destruye. El emparejamiento ES↔EN se
  // fijó por daño medio relativo al arma, no por traducción. Rampa de color de gris (peor) a rojo
  // (mejor): la leyenda se lee sola sin memorizar seis colores arbitrarios.
  const QUAL_NAMES = ["Roza", "Alcanza", "Impacta", "Perfora", "Destroza", "Destruye"] as const;
  const QUAL_COLORS = ["#8b949e", "#5b9bd1", "#57c785", "#d29922", "#f0883e", "#e5534b"] as const;
  const qualLines = QUAL_NAMES.map((name, i) => {
    const m = new Map<string, number>();
    for (const q of glQuality) {
      if (q.quality !== i + 1) continue;
      if ((from && q.date < from) || (to && q.date > to)) continue;
      const k = bucketKey(q.date);
      m.set(k, (m.get(k) ?? 0) + (qdir === "done" ? q.done : q.taken));
    }
    return { name: tr(name), color: QUAL_COLORS[i], values: qlLabels.map((l) => m.get(l) ?? 0) };
  }).filter((s) => s.values.some((v) => v > 0));

  // ---- Salvage (gamelog): restos recuperados e intentos fallidos. Cuentas, no ISK.
  const bkSalv = { ok: new Map<string, number>(), fail: new Map<string, number>() };
  for (const s of glSalvage) {
    if ((from && s.date < from) || (to && s.date > to)) continue;
    const k = bucketKey(s.date);
    bkSalv.ok.set(k, (bkSalv.ok.get(k) ?? 0) + s.salvaged);
    bkSalv.fail.set(k, (bkSalv.fail.get(k) ?? 0) + s.failed);
  }
  const salvLines = [
    { name: tr("Restos recuperados"), color: "#57c785", values: svLabels.map((l) => bkSalv.ok.get(l) ?? 0) },
    { name: tr("Intentos fallidos"), color: "#d76a6a", values: svLabels.map((l) => bkSalv.fail.get(l) ?? 0) },
  ].filter((s) => s.values.some((v) => v > 0));

  // ---- DPS (gamelog): daño / segundos ACTIVOS del bucket. La división va DESPUÉS de agregar
  // (SUM(dmg)/SUM(secs)): promediar los DPS diarios daría más peso a los días flojos. El pico es
  // el mejor segundo del bucket — el máximo no se promedia, se conserva.
  const bkDps = new Map<string, { dmg: number; secs: number; peak: number }>();
  for (const d of glDps) {
    if ((from && d.date < from) || (to && d.date > to)) continue;
    const k = bucketKey(d.date);
    const e = bkDps.get(k) ?? { dmg: 0, secs: 0, peak: 0 };
    e.dmg += d.dmg;
    e.secs += d.secs;
    if (d.peak > e.peak) e.peak = d.peak;
    bkDps.set(k, e);
  }
  const dpsLines = [
    {
      name: tr("DPS medio (en combate)"),
      color: "#57c785",
      values: dpLabels.map((l) => {
        const e = bkDps.get(l);
        return e && e.secs > 0 ? e.dmg / e.secs : 0;
      }),
    },
    {
      name: tr("Pico (mejor segundo)"),
      color: "#f0883e",
      values: dpLabels.map((l) => bkDps.get(l)?.peak ?? 0),
    },
  ].filter((s) => s.values.some((v) => v > 0));
  // ISK por rata: calidad del rateo. Sube al cazar capitales, baja al limpiar frigatas.
  const iskRatLine = {
    name: tr("ISK por rata (bruto)"),
    color: "#d29922",
    values: chartLabels.map((l, i) => (ratsVals[i] > 0 ? (bkGross.get(l) ?? 0) / ratsVals[i] : 0)),
  };
  const iskRatNet = {
    name: tr("ISK por rata (cobrado)"),
    color: "#c8d3df",
    values: chartLabels.map((l, i) => (ratsVals[i] > 0 ? (cobradoBk.get(l) ?? 0) / ratsVals[i] : 0)),
  };

  // En modo "Ratas" e "ISK/rata" NO existe la línea del gamelog: el log registra daño, no muertes.
  // Antes que inventarla a partir del daño, desaparece. Y los desgloses por sistema/personaje son
  // ISK, así que tampoco pintan ahí.
  const lineSeries =
    mag === "rats"
      ? [ratsLine]
      : mag === "spec"
        ? specLines
        : mag === "iskrat"
          ? [iskRatNet, ...(hasGross ? [iskRatLine] : [])]
          : mag === "dmg"
            ? dmgLines
            : mag === "miss"
              ? missLines
              : mag === "qual"
                ? qualLines
                : mag === "salv"
                  ? salvLines
                  : mag === "dps"
                    ? dpsLines
                    : [
                ...baseLines,
                ...(hasGross ? [grossLine] : []),
                ...(glOn ? [glLine] : []),
                ...(glOn && hasLost ? [lostLine] : []),
              ];
  const countFmt = (n: number) => fmtSp(Math.round(n));
  const chartFmt = mag === "isk" || mag === "iskrat" ? fmtIsk : countFmt;
  const magLabel =
    mag === "rats"
      ? tr("Ratas")
      : mag === "spec"
        ? tr("Ratas especiales")
        : mag === "iskrat"
          ? tr("ISK por rata")
          : mag === "dmg"
            ? tr("Daño por arma")
            : mag === "miss"
              ? tr("Fallos por arma")
              : mag === "qual"
                ? tr("Calidad del golpe")
                : mag === "salv"
                  ? tr("Salvage")
                  : mag === "dps"
                    ? "DPS"
                    : cumulative
                    ? `ISK (${tr("acumulado")})`
                    : "ISK";

  return (
    <>
      <div className="kpis">
        {/* El precio de lo que mataste, y qué porcentaje acabó en tu cartera. Solo si ESI trae el
            desglose; sin él no se inventa un porcentaje sobre un denominador que no existe. */}
        {rangeGross > 0 && (
          <Kpi label={tr("Precio de las ratas")} value={fmtIsk(rangeGross)} />
        )}
        {rangeGross > 0 && (
          <Kpi label={tr("Te llegó")} value={`${((totalIsk / rangeGross) * 100).toFixed(1)}%`} tone="pos" />
        )}
        <Kpi label={tr("ISK total (bounty + ESS)")} value={fmtIsk(totalIsk)} tone="pos" />
        <Kpi label={tr("Bounties")} value={fmtIsk(rangeBounty)} tone="pos" />
        <Kpi label={tr("ESS")} value={fmtIsk(rangeEss)} tone="pos" />
        <Kpi label={tr("Ratas eliminadas")} value={fmtSp(rangeRats)} />
        <Kpi
          label={tr("Ratas especiales")}
          value={special ? fmtSp(special.total) : "…"}
          tone={special && special.total > 0 ? "pos" : undefined}
        />
        <Kpi label={tr("ISK / hora (estim.)")} value={fmtIsk(iskPerHour)} />
      </div>

      <div className="rateo-controls">
        <div className="seg">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} className={gran === g ? "active" : ""} onClick={() => setGran(g)}>
              {g === "day" ? tr("Día") : g === "week" ? tr("Semana") : g === "month" ? tr("Mes") : tr("Año")}
            </button>
          ))}
        </div>
        <RangePresets from={from} to={to} setFrom={setFrom} setTo={setTo} years={rateoYears} />
        <label className="rateo-date">
          {tr("Desde")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="rateo-date">
          {tr("Hasta")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button
            className="rateo-clear"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Limpiar
          </button>
        )}
        <div className="seg seg-sm" title={tr("Qué magnitud dibuja la gráfica")}>
          {(
            [
              ["isk", "ISK"],
              ["rats", tr("Ratas")],
              ["spec", tr("Especiales")],
              ["iskrat", tr("ISK/rata")],
              ["dmg", tr("Daño")],
              ["miss", tr("Fallos")],
              ["qual", tr("Calidad")],
              ["salv", tr("Salvage")],
              ["dps", "DPS"],
            ] as const
          )
            // Daño y Fallos solo tienen sentido si el gamelog está escaneado; Especiales, si cayó alguna.
            .filter(([m]) => (m !== "dmg" && m !== "miss") || glWeapons.length > 0)
            .filter(([m]) => m !== "spec" || (special?.daily?.length ?? 0) > 0)
            // Calidad, Salvage y DPS: solo si el gamelog trajo alguna fila (exigen haber reescaneado).
            .filter(([m]) => m !== "qual" || glQuality.length > 0)
            .filter(([m]) => m !== "salv" || glSalvage.length > 0)
            .filter(([m]) => m !== "dps" || glDps.length > 0)
            .map(([m, lbl]) => (
              <button key={m} className={mag === m ? "active" : ""} onClick={() => setMag(m)}>
                {lbl}
              </button>
            ))}
        </div>
        {/* La calidad existe en las DOS direcciones (en los golpes recibidos falta a menudo el arma,
            pero el escalón sí está). Un toggle, no dos magnitudes: es la misma pregunta con otro sujeto. */}
        {mag === "qual" && (
          <div className="seg seg-sm">
            <button className={qdir === "done" ? "active" : ""} onClick={() => setQdir("done")}>
              {tr("Dados")}
            </button>
            <button className={qdir === "taken" ? "active" : ""} onClick={() => setQdir("taken")}>
              {tr("Recibidos")}
            </button>
          </div>
        )}
        {/* La línea del gamelog solo existe en ISK: el log registra daño, no muertes. */}
        {glBounty.length > 0 && mag === "isk" && (
          <button
            className={`gl-toggle${showGl ? " active" : ""}`}
            onClick={() => setShowGl((v) => !v)}
            title={tr("Desglosa lo cobrado en bounty y pagos del ESS, y superpone el bounty que registró tu gamelog. Tres fuentes separadas: no se fusionan ni se restan.")}
          >
            ┈ {tr("gamelog")}
          </button>
        )}
      </div>
      {(mag === "dmg" || mag === "miss") && (
        <p className="muted small gl-note">
          {tr(
            "Del gamelog, por arma o dron, y de todo tu histórico. Es daño y fallos, NO muertes: el log no dice qué arma remató a cada rata, y en un mismo segundo golpeas a varios objetivos.",
          )}{" "}
          {tr("Solo contra NPC: tu daño a jugadores vive en la sección PvP, en Cara a cara.")}
        </p>
      )}
      {mag === "qual" && (
        <p className="muted small gl-note">
          {tr(
            "Del gamelog, todo tu histórico. Seis escalones de calidad, de Roza (el peor) a Destruye (wrecking): la misma escala en español y en inglés, emparejada por el daño medio de cada verbo, no por traducción.",
          )}{" "}
          {tr("Suma PvE y PvP: separarlos exige reprocesar el histórico (pendiente del próximo lote).")}
        </p>
      )}
      {mag === "salv" && (
        <p className="muted small gl-note">
          {tr(
            "Del gamelog, todo tu histórico: restos de naves recuperados con éxito e intentos que fallaron. El log no dice qué salió de cada resto; eso solo lo sabe tu bodega.",
          )}
        </p>
      )}
      {mag === "dps" && (
        <p className="muted small gl-note">
          {tr(
            "Del gamelog. El DPS medio divide el daño entre los segundos EN COMBATE (segundos con al menos un golpe tuyo), no entre el tiempo de sesión — es tu ritmo real mientras disparas. El pico es el mejor segundo del período.",
          )}{" "}
          {tr("Suma PvE y PvP: separarlos exige reprocesar el histórico (pendiente del próximo lote).")}
        </p>
      )}
      {(mag === "rats" || mag === "iskrat" || mag === "spec") && (
        <p className="muted small gl-note">
          {tr("Las ratas salen del desglose de cada pago de ESI. El gamelog no las cuenta: registra daño, no muertes.")}
          {ratsScoped && (
            <>
              {" "}
              {tr("Fuera de")} {ratsFrom}–{ratsTo}{" "}
              {tr(
                "no hay desglose (las filas importadas del CSV no lo traen), así que el eje se recorta ahí: no es que mataras cero ratas, es que no se sabe.",
              )}{" "}
              {tr("La ventana crece con cada sincronización.")}
              {/* Con dos meses de dato, la vista mensual son dos puntos. No es un fallo, pero tampoco
                  se lee: mejor decirle dónde SÍ hay curva que dejarle mirando una línea recta. */}
              {chartLabels.length < 4 && gran === "month" && (
                <>
                  {" "}
                  <b>{tr("Prueba «Día» o «Semana»: en «Mes» hay muy pocos puntos.")}</b>
                </>
              )}
            </>
          )}
        </p>
      )}

      <div className="top-list">
        <div className="rateo-charthead">
          <h4>
            {magLabel} {tr("por")} {granLabel}
          </h4>
          {/* El desglose por sistema/personaje es ISK; en las otras magnitudes no aplica. */}
          {multiChar && mag === "isk" && (
            <div className="seg seg-sm">
              <button className={dim === "sys" ? "active" : ""} onClick={() => setDim("sys")}>
                {tr("Por sistema")}
              </button>
              <button className={dim === "char" ? "active" : ""} onClick={() => setDim("char")}>
                {tr("Por personaje")}
              </button>
            </div>
          )}
        </div>
        {/* Ratas, Especiales y Fallos son CUENTAS: línea recta. Suavizarlas dibujaba media capital
            entre dos semanas y sobrepasaba el máximo (8,2 faction donde hubo 8). ISK sí se suaviza. */}
        <MultiLineProgress
          labels={chartLabels}
          series={lineSeries}
          fmt={chartFmt}
          straight={mag === "rats" || mag === "spec" || mag === "miss" || mag === "qual" || mag === "salv" || mag === "dps"}
        />
      </div>

      {special && special.by_type.length > 0 && (
        <div className="top-list">
          <h4>
            {tr("Ratas especiales")} ·{" "}
            <span className="muted small">
              {special.officers} {tr("oficiales")} · {special.capitals} {tr("capitales")} ·{" "}
              {special.faction} {tr("faction")}
            </span>
          </h4>
          <div className="special-rats">
            {special.by_type.map((r) => (
              <div className="special-rat" key={r.type_id} title={r.name ?? `#${r.type_id}`}>
                <img src={typeIcon(r.type_id, 32)} alt="" width={26} height={26} />
                <span className="special-rat-name">{r.name ?? `#${r.type_id}`}</span>
                <span className={`special-rat-tag ${r.class}`}>
                  {r.class === "officer"
                    ? tr("Oficial")
                    : r.class === "capital"
                      ? tr("Capital")
                      : tr("Faction")}
                </span>
                <span className="special-rat-count">×{fmtSp(r.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {special == null && (
        <div className="top-list">
          <p className="muted small">{tr("Calculando ratas especiales… (puede tardar la 1ª vez)")}</p>
        </div>
      )}

      <div className="top-list">
        <h4>{tr("Detalle por sistema")}</h4>
        {/* Las dos columnas de ISK NO son comparables entre sí y hay que decirlo donde se ven. */}
        <p className="muted small">
          {esiSysCov < 0.995 && (
            <>
              {tr("Del ISK cobrado, solo lleva sistema el")} {(esiSysCov * 100).toFixed(0)}%
              {": "}
              {tr(
                "el wallet solo sabe dónde ocurrió cada pago cuando ESI lo etiquetó, y las filas importadas del CSV no lo traen.",
              )}{" "}
            </>
          )}
          {showGl && glSysCov > 0 && (
            <>
              {tr(
                "El bruto sale del gamelog y llega a 2019: es lo que valían las ratas, no lo que cobraste. No dividas una columna por la otra.",
              )}
              {glSysCov < 0.995 && (
                <>
                  {" "}
                  {tr("Se pudo situar en un sistema el")} {(glSysCov * 100).toFixed(0)}%{" "}
                  {tr("del bruto.")}
                </>
              )}
            </>
          )}
        </p>
        <table className="km-table">
          <thead>
            <tr>
              <th>{tr("Sistema")}</th>
              <th>ISK</th>
              <th>%</th>
              <th>ISK/h</th>
              <th>Bounty</th>
              <th>ESS</th>
              <th>{tr("Ratas")}</th>
              {showGl && <th>{tr("Bruto (gamelog)")}</th>}
              <th>{tr("Ratas especiales")}</th>
            </tr>
          </thead>
          <tbody>
            {topSystems.map((s) => {
              const sp = special?.by_system.find((b) => b.system_id === s.system_id);
              const pct = allTimeIsk > 0 ? (s.isk / allTimeIsk) * 100 : 0;
              const iskH = s.active_hours > 0 ? s.isk / s.active_hours : 0;
              return (
                <tr key={s.system_id}>
                  <td>{sysName(s.system_id)}</td>
                  <td>{fmtIsk(s.isk)}</td>
                  <td className="muted">{pct.toFixed(1)}%</td>
                  <td>{s.active_hours > 0 ? fmtIsk(iskH) : "—"}</td>
                  <td>{fmtIsk(s.bounty)}</td>
                  <td>{fmtIsk(s.ess)}</td>
                  <td>{fmtSp(s.rats)}</td>
                  {showGl && (
                    <td className="muted">
                      {glSys.has(sysName(s.system_id)) ? fmtIsk(glSys.get(sysName(s.system_id))!.isk) : "—"}
                    </td>
                  )}
                  <td>
                    {sp ? (
                      <div className="sys-special">
                        {sp.by_type.map((r) => (
                          <span
                            key={r.type_id}
                            className={`special-rat-tag ${r.class}`}
                            title={`${r.name ?? `#${r.type_id}`} ×${r.count} (${
                              r.class === "officer"
                                ? tr("Oficial")
                                : r.class === "capital"
                                  ? tr("Capital")
                                  : tr("Faction")
                            })`}
                          >
                            {r.name ?? `#${r.type_id}`} ×{r.count}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* Sistemas donde rateaste ANTES de que existiera tu histórico de wallet. Del wallet no hay
                nada que enseñar ahí; del gamelog, sí. Guiones donde no hay dato, nunca un cero. */}
            {showGl &&
              glOnlySystems.map(([name, g]) => (
                <tr key={`gl-${name}`} className="muted">
                  <td>{name}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{fmtIsk(g.isk)}</td>
                  <td>—</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <PapersBlock series={paperSeries} data={abyssals} />
    </>
  );
}

/* ---------- Resumen (dashboard financiero) ---------- */

function PapersBlock({
  series,
  data,
}: {
  series: PaperSeries | null;
  data: AbyssalsData | null;
}) {
  const srcLabel: Record<string, string> = { abyssal: tr("Abyssals"), crab: tr("CRAB") };
  const srcColor: Record<string, string> = { abyssal: DONUT_COLORS[0], crab: DONUT_COLORS[1] };
  const days = series?.daily ?? [];
  const dates = [...new Set(days.map((d) => d.date))].sort();
  const sources = [...new Set(days.map((d) => d.source))];
  const valAt = (date: string, src: string) =>
    days.find((d) => d.date === date && d.source === src)?.value ?? 0;
  const chartSeries = sources.map((src) => ({
    name: srcLabel[src] ?? src,
    color: srcColor[src] ?? DONUT_COLORS[0],
    values: dates.map((d) => valAt(d, src)),
  }));
  const groups = (data?.papers ?? []).filter((g) => g.qty > 0);
  return (
    <div className="papers-block">
      <h4>💠 {tr("Papeles (loot redimible — estimado)")}</h4>
      <p className="muted small">
        {tr("Valor ESTIMADO a precio de mercado del loot redimible (Abyssals + CRAB). La gráfica ACUMULA los papeles que vas ganando (detecta las subidas de cantidad en tus assets en cada sync y las suma, como el ISK del wallet); vender no resta. No es ISK realizado: es una estimación a mercado.")}
      </p>
      {dates.length >= 2 ? (
        <>
          <div className="rateo-charthead">
            <span className="muted small">{tr("Papeles acumulados (ganados) · valor estimado a mercado")}</span>
          </div>
          <MultiLineProgress labels={dates} series={chartSeries} fmt={fmtIsk} />
        </>
      ) : (
        <p className="muted small">
          {tr("La gráfica acumulada se construye con el tiempo: cada sync (y cada vez que abres esta vista) guarda una foto del inventario y suma lo nuevo. Necesita al menos dos lecturas en días distintos.")}
        </p>
      )}
      {data && (
        <>
          <div className="kpis">
            <Kpi label={tr("Papeles en inventario")} value={fmtSp(data.papers_qty)} />
            <Kpi label={tr("Valor estimado (mercado)")} value={fmtIsk(data.papers_value)} tone="pos" />
          </div>
          {groups.length === 0 ? (
            <p className="muted small">
              {tr("No tienes papeles en assets (o falta el scope de assets). Es el loot redimible que vendes en el mercado.")}
            </p>
          ) : (
            <div className="resumen-grid">
              {groups.map((g) => (
                <div className="top-list" key={g.type_id}>
                  <h4 style={{ color: srcColor[g.source] }}>
                    {tr("Inventario")} {srcLabel[g.source] ?? g.name}
                  </h4>
                  <div className="kpis">
                    <Kpi label={tr("Cantidad")} value={fmtSp(g.qty)} />
                    <Kpi label={tr("Valor estimado")} value={fmtIsk(g.value)} tone="pos" />
                  </div>
                  <table className="km-table cat-table">
                    <thead>
                      <tr>
                        <th>{tr("Ubicación")}</th>
                        <th style={{ textAlign: "right" }}>{tr("Cantidad")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.by_loc.map((p, i) => (
                        <tr key={i}>
                          <td>{p.location_name || `#${p.system_id}`}</td>
                          <td style={{ textAlign: "right" }}>{fmtSp(p.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

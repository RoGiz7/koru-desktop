import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

// ---- Audio de alertas (Web Audio) + notificación nativa ----
// Sintetiza los avisos de intel sin ficheros (salvo el "personalizado"). Un gesto del usuario
// "desbloquea" el AudioContext (políticas de autoplay del navegador/WebView).

let _actx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    if (!_actx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      _actx = new Ctx();
    }
    if (_actx.state === "suspended") void _actx.resume();
    return _actx;
  } catch {
    return null;
  }
}
// Un tono con envolvente attack/decay. Llamar desde un gesto del usuario "desbloquea" el audio.
function tone(
  freq: number,
  startAt: number,
  dur: number,
  type: OscillatorType = "square",
  peak = 0.14
) {
  const ctx = audioCtx();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g);
  g.connect(ctx.destination);
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + startAt;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}
// Un barrido de frecuencia (para sirena/sonar): lista de [tiempoRel, frec].
function sweep(points: [number, number][], dur: number, type: OscillatorType, peak: number) {
  const ctx = audioCtx();
  if (!ctx || points.length === 0) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g);
  g.connect(ctx.destination);
  o.type = type;
  const t0 = ctx.currentTime;
  o.frequency.setValueAtTime(points[0][1], t0);
  for (const [dt, f] of points) o.frequency.linearRampToValueAtTime(f, t0 + dt);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
// Catálogo de sonidos de alerta integrados (clave → etiqueta). Basado en los tipos de alerta
// mejor valorados: ping cristalino (alta prioridad), chime de 2 notas, alarma corta, campana, sonar.
export const ALERT_SOUNDS: { key: string; label: string }[] = [
  { key: "ping", label: "Ping cristalino" },
  { key: "double", label: "Chime (dos notas)" },
  { key: "triple", label: "Alarma (urgente)" },
  { key: "bell", label: "Campana" },
  { key: "sonar", label: "Sonar" },
  { key: "siren", label: "Sirena" },
  { key: "custom", label: "Personalizado (archivo)" },
];
function playPreset(key: string) {
  if (!audioCtx()) return;
  if (key === "ping") {
    // Ping brillante tipo cristal: fundamental + octava de brillo, decaimiento corto.
    tone(1568, 0, 0.38, "sine", 0.24);
    tone(3136, 0, 0.22, "sine", 0.05);
  } else if (key === "triple") {
    // Alarma urgente: tres pulsos cortos y brillantes.
    tone(1047, 0, 0.09, "square", 0.16);
    tone(1047, 0.14, 0.09, "square", 0.16);
    tone(1047, 0.28, 0.11, "square", 0.16);
  } else if (key === "siren") {
    sweep([[0, 600], [0.3, 1100], [0.6, 600]], 0.62, "sawtooth", 0.12);
  } else if (key === "bell") {
    // Campana: fundamental + parcial inarmónico (~2.76×), cola larga.
    tone(880, 0, 0.95, "sine", 0.22);
    tone(2429, 0, 0.6, "sine", 0.07);
  } else if (key === "sonar") {
    // Ping de sonar: descenso de tono con cola + eco suave.
    sweep([[0, 900], [0.5, 480]], 0.55, "sine", 0.2);
    tone(700, 0.55, 0.3, "sine", 0.07);
  } else {
    // "double" (por defecto): chime ascendente de dos notas, suave.
    tone(784, 0, 0.18, "triangle", 0.17);
    tone(1175, 0.16, 0.5, "triangle", 0.17);
  }
}
// Sonido personalizado desde un archivo (cargado vía Rust → Blob, reproducible aun minimizado).
let _customAudio: HTMLAudioElement | null = null;
let _customUrl: string | null = null;
export async function loadCustomSound(path: string) {
  try {
    const bytes = await invoke<number[]>("read_audio_file", { path });
    const blob = new Blob([new Uint8Array(bytes)]);
    if (_customUrl) URL.revokeObjectURL(_customUrl);
    _customUrl = URL.createObjectURL(blob);
    _customAudio = new Audio(_customUrl);
  } catch {
    _customAudio = null;
  }
}
function playCustom() {
  if (_customAudio) {
    _customAudio.currentTime = 0;
    void _customAudio.play().catch(() => {});
  } else {
    playPreset("double"); // fallback si el archivo no cargó
  }
}
// Pitido simple (para desbloquear audio con un gesto).
export function beep() {
  tone(880, 0, 0.18);
}

// Fanfarria de logro desbloqueado (Bitácora): arpegio ascendente triunfal + brillo final.
// Distinto de las alertas de intel (esto es una buena noticia, no un aviso de peligro).
export function playUnlock() {
  if (!audioCtx()) return;
  // Do–Mi–Sol–Do (mayor), notas cortas y brillantes.
  tone(523, 0, 0.14, "triangle", 0.16);
  tone(659, 0.12, 0.14, "triangle", 0.16);
  tone(784, 0.24, 0.16, "triangle", 0.17);
  tone(1047, 0.38, 0.5, "triangle", 0.18);
  tone(2093, 0.38, 0.35, "sine", 0.05); // octava de brillo (campanilla)
}
// Reproduce la alerta según la elección del usuario.
export function playAlertChoice(choice: string) {
  if (choice === "custom") playCustom();
  else playPreset(choice);
}

// Notificación nativa del SO (alarma de intel aunque la app esté minimizada).
let _notifPerm: boolean | null = null;
export async function ensureNotifPerm(): Promise<boolean> {
  if (_notifPerm !== null) return _notifPerm;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    _notifPerm = granted;
  } catch {
    _notifPerm = false;
  }
  return _notifPerm ?? false;
}

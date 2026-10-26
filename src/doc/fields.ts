// What the inspector shows for each kind of object: field types, labels and
// HaxBall's defaults, plus helpers for flags, colors and trait inheritance.
import { Flag } from "../vendor/kickr/shared/flags";
import { isObject, type Json, type JsonObject } from "./json";
import type { ListKey } from "./model";

export type FieldKind = "number" | "text" | "bool" | "flags" | "color" | "vec" | "team" | "trait" | "enum" | "jointLength" | "jointStrength" | "index";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  // HaxBall's value when the field is left out (shown, never written).
  def?: Json;
  hint?: string;
  options?: [string, string][];
  step?: number;
}

const ALL = ["all"];
const n = (key: string, label: string, def?: number, hint?: string, step = 1): FieldDef => ({ key, label, kind: "number", def, hint, step });
const flags = (key: string, label: string, def: string[], hint: string): FieldDef => ({ key, label, kind: "flags", def, hint });
const trait: FieldDef = { key: "trait", label: "Trait", kind: "trait", hint: "Preset do arquivo: preenche os campos que o objeto não define." };
const bCoef = (def: number) => n("bCoef", "Quique (bCoef)", def, "Coeficiente de restituição: 0 absorve, 1 devolve toda a velocidade.", 0.05);
const cMask = flags("cMask", "Colide com (cMask)", ALL, "Grupos com que este objeto colide.");
const cGroup = (def: string[]) => flags("cGroup", "Grupos (cGroup)", def, "Grupos a que este objeto pertence.");

export const ITEM_FIELDS: Record<ListKey, FieldDef[]> = {
  vertexes: [trait, n("x", "X"), n("y", "Y"), bCoef(1), cMask, cGroup(["wall"])],
  segments: [
    trait,
    { key: "v0", label: "Vértice 1", kind: "index" },
    { key: "v1", label: "Vértice 2", kind: "index" },
    n("curve", "Curva (°)", 0, "Ângulo do arco entre os vértices. Negativo curva para o outro lado; abaixo de 10° fica reto.", 5),
    n("curveF", "curveF", undefined, "Forma alternativa da curva (1/tan(ângulo/2)). Tem prioridade sobre a curva.", 0.05),
    n("bias", "Bias", 0, "Espessura de colisão de um lado só: positivo empurra para um lado, negativo para o outro.", 1),
    { key: "vis", label: "Visível", kind: "bool", def: true },
    { key: "color", label: "Cor", kind: "color", def: "000000" },
    bCoef(1),
    cMask,
    cGroup(["wall"]),
  ],
  discs: [
    trait,
    { key: "pos", label: "Posição", kind: "vec", def: [0, 0] },
    n("radius", "Raio", 10),
    { key: "color", label: "Cor", kind: "color", def: "FFFFFF" },
    { key: "speed", label: "Velocidade inicial", kind: "vec", def: [0, 0] },
    { key: "gravity", label: "Gravidade", kind: "vec", def: [0, 0] },
    n("invMass", "Massa inversa (invMass)", 1, "0 = imóvel (massa infinita).", 0.1),
    n("damping", "Amortecimento", 0.99, "Velocidade mantida a cada frame (1 = sem atrito).", 0.001),
    bCoef(0.5),
    cMask,
    cGroup(ALL),
  ],
  goals: [
    trait,
    { key: "p0", label: "Ponto inicial", kind: "vec" },
    { key: "p1", label: "Ponto final", kind: "vec" },
    { key: "team", label: "Time", kind: "team", hint: "Gol do time: a bola que cruza a linha marca para o adversário." },
  ],
  planes: [
    trait,
    { key: "normal", label: "Normal", kind: "vec", hint: "Aponta para o lado onde os discos podem ficar." },
    n("dist", "Distância", undefined, "Distância da origem ao plano, ao longo da normal."),
    bCoef(1),
    cMask,
    cGroup(["wall"]),
  ],
  joints: [
    trait,
    { key: "d0", label: "Disco 1", kind: "index" },
    { key: "d1", label: "Disco 2", kind: "index" },
    { key: "length", label: "Comprimento", kind: "jointLength", def: null, hint: "Vazio = distância inicial entre os discos. Dois valores = faixa mín./máx." },
    { key: "strength", label: "Rigidez", kind: "jointStrength", def: "rigid" },
    { key: "color", label: "Cor", kind: "color", def: "000000" },
  ],
  redSpawnPoints: [],
  blueSpawnPoints: [],
};

export interface Section {
  title: string;
  // Fields live in this top-level object (e.g. "bg"), or at the top level.
  path?: string;
  fields: FieldDef[];
}

export const ROOT_SECTIONS: Section[] = [
  {
    title: "Estádio",
    fields: [
      { key: "name", label: "Nome", kind: "text" },
      n("width", "Largura", undefined, "Metade da largura da área da câmera: até onde ela anda em X."),
      n("height", "Altura", undefined, "Metade da altura da área da câmera: até onde ela anda em Y."),
      n("spawnDistance", "Spawn", 200, "Distância do centro até onde os jogadores começam."),
      n("maxViewWidth", "Visão máxima", 0, "Largura máxima que a câmera mostra. 0 = sem limite."),
      { key: "cameraFollow", label: "Câmera segue", kind: "enum", def: "ball", options: [["ball", "Bola e jogador"], ["player", "Jogador"]] },
      { key: "kickOffReset", label: "Reset do kickoff", kind: "enum", def: "partial", options: [["partial", "Parcial (só bola e jogadores)"], ["full", "Completo (todos os discos)"]] },
      { key: "canBeStored", label: "Pode ser salvo", kind: "bool", def: true, hint: "Se os jogadores podem guardar o estádio na lista deles." },
    ],
  },
  {
    title: "Fundo",
    path: "bg",
    fields: [
      { key: "type", label: "Tipo", kind: "enum", def: "none", options: [["none", "Nenhum"], ["grass", "Grama"], ["hockey", "Hockey"]] },
      n("width", "Largura", 0),
      n("height", "Altura", 0),
      n("kickOffRadius", "Círculo central", 0, "Raio do círculo central desenhado no fundo."),
      n("cornerRadius", "Cantos", 0, "Raio dos cantos arredondados do fundo."),
      n("goalLine", "Linha do gol", 0, "Só no fundo hockey."),
      { key: "color", label: "Cor", kind: "color", def: "718C5A" },
    ],
  },
  {
    title: "Física do jogador",
    path: "playerPhysics",
    fields: [
      n("radius", "Raio", 15),
      n("bCoef", "Quique (bCoef)", 0.5, undefined, 0.05),
      n("invMass", "Massa inversa", 0.5, undefined, 0.1),
      n("damping", "Amortecimento", 0.96, undefined, 0.001),
      n("acceleration", "Aceleração", 0.1, undefined, 0.01),
      n("kickingAcceleration", "Acel. chutando", 0.07, "Aceleração enquanto segura o chute.", 0.01),
      n("kickingDamping", "Amort. chutando", 0.96, "Amortecimento enquanto segura o chute.", 0.001),
      n("kickStrength", "Força do chute", 5, undefined, 0.5),
      n("kickback", "Recuo do chute", 0, undefined, 0.5),
      { key: "gravity", label: "Gravidade", kind: "vec", def: [0, 0] },
      flags("cGroup", "Grupos extras (cGroup)", [], "Somados aos grupos do time."),
    ],
  },
];

export const BALL_FIELDS: FieldDef[] = [
  trait,
  n("radius", "Raio", 10),
  { key: "color", label: "Cor", kind: "color", def: "FFFFFF" },
  n("invMass", "Massa inversa (invMass)", 1, undefined, 0.1),
  n("damping", "Amortecimento", 0.99, undefined, 0.001),
  bCoef(0.5),
  { key: "gravity", label: "Gravidade", kind: "vec", def: [0, 0] },
  cMask,
  flags("cGroup", "Grupos (cGroup)", ["ball"], "kick e score são sempre somados à bola."),
];

// ---- Trait inheritance -----------------------------------------------------

export type Origin = "own" | "trait" | "default";

export function traitsOf(fields: JsonObject): Record<string, JsonObject> {
  const t = fields.traits;
  if (!isObject(t)) return {};
  const out: Record<string, JsonObject> = {};
  for (const k of Object.keys(t)) if (isObject(t[k])) out[k] = t[k] as JsonObject;
  return out;
}

// Like HaxBall: the trait fills in what the object leaves unset (null or missing).
export function effective(o: JsonObject, key: string, traits: Record<string, JsonObject>, def?: Json): { value: Json | undefined; origin: Origin } {
  if (o[key] != null) return { value: o[key], origin: "own" };
  const t = typeof o.trait === "string" ? traits[o.trait] : undefined;
  if (t && t[key] != null && key !== "trait") return { value: t[key], origin: "trait" };
  return { value: def, origin: "default" };
}

// ---- Flags -----------------------------------------------------------------

export const FLAG_NAMES = ["ball", "red", "blue", "redKO", "blueKO", "wall", "kick", "score", "c0", "c1", "c2", "c3"] as const;
export const FLAG_LABELS: Record<string, string> = {
  ball: "bola",
  red: "red",
  blue: "blue",
  redKO: "redKO",
  blueKO: "blueKO",
  wall: "parede",
  kick: "kick",
  score: "score",
  c0: "c0",
  c1: "c1",
  c2: "c2",
  c3: "c3",
};

export function flagBits(v: Json | undefined): number {
  if (!Array.isArray(v)) return 0;
  let bits = 0;
  for (const name of v) bits |= (Flag as Record<string, number>)[name as string] ?? 0;
  return bits;
}

export function flagNames(bits: number): string[] {
  const names: string[] = [];
  const all = (bits & Flag.all) === Flag.all;
  if (all) names.push("all");
  for (const name of FLAG_NAMES) {
    const b = Flag[name];
    if ((bits & b) && !(all && b & Flag.all)) names.push(name);
  }
  return names;
}

// ---- Colors ----------------------------------------------------------------

// -1 for transparent, null when unreadable.
export function colorValue(v: Json | undefined): number | null {
  if (v === "transparent") return -1;
  if (typeof v === "string") {
    const c = parseInt(v, 16);
    return Number.isNaN(c) ? null : c & 0xffffff;
  }
  if (Array.isArray(v) && v.length >= 3) return (((v[0] as number) | 0) << 16) + (((v[1] as number) | 0) << 8) + ((v[2] as number) | 0);
  return null;
}

export const hexColor = (c: number) => (c & 0xffffff).toString(16).toUpperCase().padStart(6, "0");

// Writes a color in the same notation as the value it replaces.
export function colorJson(c: number, like: Json | undefined): Json {
  if (c < 0) return "transparent";
  if (Array.isArray(like)) return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  return hexColor(c);
}

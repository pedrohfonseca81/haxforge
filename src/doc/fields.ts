// What the inspector shows for each kind of object: field types, labels and
// HaxBall's defaults, plus helpers for flags, colors and trait inheritance.
import { Flag } from "../vendor/kickr/shared/flags";
import { tr } from "../i18n";
import { isObject, type Json, type JsonObject } from "./json";
import type { ListKey } from "./model";

export type FieldKind = "number" | "text" | "bool" | "flags" | "color" | "vec" | "team" | "trait" | "enum" | "jointLength" | "jointStrength" | "index";

export interface FieldDef {
  key: string;
  readonly label: string;
  kind: FieldKind;
  // HaxBall's value when the field is left out (shown, never written).
  def?: Json;
  readonly hint?: string;
  readonly options?: [string, string][];
  step?: number;
}

const ALL = ["all"];
const f = (
  key: string,
  label: [string, string],
  kind: FieldKind,
  opts: { def?: Json; hint?: [string, string]; options?: [string, string, string][]; step?: number } = {},
): FieldDef => ({
  key,
  kind,
  def: opts.def,
  step: opts.step,
  get label() {
    return tr(label[0], label[1]);
  },
  get hint() {
    return opts.hint ? tr(opts.hint[0], opts.hint[1]) : undefined;
  },
  get options() {
    return opts.options?.map(([v, pt, en]): [string, string] => [v, tr(pt, en)]);
  },
});

const n = (key: string, label: [string, string], def?: number, hint?: [string, string], step = 1): FieldDef => f(key, label, "number", { def, hint, step });
const flags = (key: string, label: [string, string], def: string[], hint: [string, string]): FieldDef => f(key, label, "flags", { def, hint });
const trait: FieldDef = f("trait", ["Trait", "Trait"], "trait", {
  hint: ["Preset do arquivo: preenche os campos que o objeto não define.", "File preset: fills in fields that the object leaves unset."],
});
const bCoef = (def: number) =>
  n("bCoef", ["Quique (bCoef)", "Bounce (bCoef)"], def, ["Coeficiente de restituição: 0 absorve, 1 devolve toda a velocidade.", "Restitution coefficient: 0 absorbs, 1 returns full velocity."], 0.05);
const cMask = flags("cMask", ["Colide com (cMask)", "Collides with (cMask)"], ALL, ["Grupos com que este objeto colide.", "Collision groups this object hits."]);
const cGroup = (def: string[]) => flags("cGroup", ["Grupos (cGroup)", "Groups (cGroup)"], def, ["Grupos a que este objeto pertence.", "Collision groups this object belongs to."]);

export const ITEM_FIELDS: Record<ListKey, FieldDef[]> = {
  vertexes: [trait, n("x", ["X", "X"]), n("y", ["Y", "Y"]), bCoef(1), cMask, cGroup(["wall"])],
  segments: [
    trait,
    f("v0", ["Vértice 1", "Vertex 1"], "index"),
    f("v1", ["Vértice 2", "Vertex 2"], "index"),
    n("curve", ["Curva (°)", "Curve (°)"], 0, ["Ângulo do arco entre os vértices. Negativo curva para o outro lado; abaixo de 10° fica reto.", "Arc angle between vertices. Negative curves the other way; below 10° is straight."], 5),
    n("curveF", ["curveF", "curveF"], undefined, ["Forma alternativa da curva (1/tan(ângulo/2)). Tem prioridade sobre a curva.", "Alternative curve form (1/tan(angle/2)). Overrides curve."], 0.05),
    n("bias", ["Bias", "Bias"], 0, ["Espessura de colisão de um lado só: positivo empurra para um lado, negativo para o outro.", "One-sided collision thickness: positive pushes one way, negative the other."], 1),
    f("vis", ["Visível", "Visible"], "bool", { def: true }),
    f("color", ["Cor", "Color"], "color", { def: "000000" }),
    bCoef(1),
    cMask,
    cGroup(["wall"]),
  ],
  discs: [
    trait,
    f("pos", ["Posição", "Position"], "vec", { def: [0, 0] }),
    n("radius", ["Raio", "Radius"], 10),
    f("color", ["Cor", "Color"], "color", { def: "FFFFFF" }),
    f("speed", ["Velocidade inicial", "Initial speed"], "vec", { def: [0, 0] }),
    f("gravity", ["Gravidade", "Gravity"], "vec", { def: [0, 0] }),
    n("invMass", ["Massa inversa (invMass)", "Inverse mass (invMass)"], 1, ["0 = imóvel (massa infinita).", "0 = immovable (infinite mass)."], 0.1),
    n("damping", ["Amortecimento", "Damping"], 0.99, ["Velocidade mantida a cada frame (1 = sem atrito).", "Speed kept each frame (1 = no friction)."], 0.001),
    bCoef(0.5),
    cMask,
    cGroup(ALL),
  ],
  goals: [
    trait,
    f("p0", ["Ponto inicial", "Start point"], "vec"),
    f("p1", ["Ponto final", "End point"], "vec"),
    f("team", ["Time", "Team"], "team", { hint: ["Gol do time: a bola que cruza a linha marca para o adversário.", "Team's goal: a ball crossing this line scores for the opponent."] }),
  ],
  planes: [
    trait,
    f("normal", ["Normal", "Normal"], "vec", { hint: ["Aponta para o lado onde os discos podem ficar.", "Points toward the side where discs are kept."] }),
    n("dist", ["Distância", "Distance"], undefined, ["Distância da origem ao plano, ao longo da normal.", "Distance from the origin to the plane along the normal."]),
    bCoef(1),
    cMask,
    cGroup(["wall"]),
  ],
  joints: [
    trait,
    f("d0", ["Disco 1", "Disc 1"], "index"),
    f("d1", ["Disco 2", "Disc 2"], "index"),
    f("length", ["Comprimento", "Length"], "jointLength", { def: null, hint: ["Vazio = distância inicial entre os discos. Dois valores = faixa mín./máx.", "Empty = initial distance between discs. Two values = min/max range."] }),
    f("strength", ["Rigidez", "Strength"], "jointStrength", { def: "rigid" }),
    f("color", ["Cor", "Color"], "color", { def: "000000" }),
  ],
  redSpawnPoints: [],
  blueSpawnPoints: [],
};

export interface Section {
  readonly title: string;
  // Fields live in this top-level object (e.g. "bg"), or at the top level.
  path?: string;
  fields: FieldDef[];
}

export const ROOT_SECTIONS: Section[] = [
  {
    get title() {
      return tr("Estádio", "Stadium");
    },
    fields: [
      f("name", ["Nome", "Name"], "text"),
      n("width", ["Largura", "Width"], undefined, ["Metade da largura da área da câmera: até onde ela anda em X.", "Half-width of the camera area: how far it travels along X."]),
      n("height", ["Altura", "Height"], undefined, ["Metade da altura da área da câmera: até onde ela anda em Y.", "Half-height of the camera area: how far it travels along Y."]),
      n("spawnDistance", ["Spawn", "Spawn"], 200, ["Distância do centro até onde os jogadores começam.", "Distance from the center to where players start."]),
      n("maxViewWidth", ["Visão máxima", "Max view width"], 0, ["Largura máxima que a câmera mostra. 0 = sem limite.", "Maximum width shown by the camera. 0 = unlimited."]),
      f("cameraFollow", ["Câmera segue", "Camera follow"], "enum", {
        def: "ball",
        options: [
          ["ball", "Bola e jogador", "Ball and player"],
          ["player", "Jogador", "Player"],
        ],
      }),
      f("kickOffReset", ["Reset do kickoff", "Kickoff reset"], "enum", {
        def: "partial",
        options: [
          ["partial", "Parcial (só bola e jogadores)", "Partial (ball and players only)"],
          ["full", "Completo (todos os discos)", "Full (all discs)"],
        ],
      }),
      f("canBeStored", ["Pode ser salvo", "Can be stored"], "bool", {
        def: true,
        hint: ["Se os jogadores podem guardar o estádio na lista deles.", "Whether players can save the stadium in their list."],
      }),
    ],
  },
  {
    get title() {
      return tr("Fundo", "Background");
    },
    path: "bg",
    fields: [
      f("type", ["Tipo", "Type"], "enum", {
        def: "none",
        options: [
          ["none", "Nenhum", "None"],
          ["grass", "Grama", "Grass"],
          ["hockey", "Hockey", "Hockey"],
        ],
      }),
      n("width", ["Largura", "Width"], 0),
      n("height", ["Altura", "Height"], 0),
      n("kickOffRadius", ["Círculo central", "Center circle"], 0, ["Raio do círculo central desenhado no fundo.", "Radius of the center circle drawn on the background."]),
      n("cornerRadius", ["Cantos", "Corners"], 0, ["Raio dos cantos arredondados do fundo.", "Radius of the rounded corners on the background."]),
      n("goalLine", ["Linha do gol", "Goal line"], 0, ["Só no fundo hockey.", "Hockey background only."]),
      f("color", ["Cor", "Color"], "color", { def: "718C5A" }),
    ],
  },
  {
    get title() {
      return tr("Física do jogador", "Player physics");
    },
    path: "playerPhysics",
    fields: [
      n("radius", ["Raio", "Radius"], 15),
      n("bCoef", ["Quique (bCoef)", "Bounce (bCoef)"], 0.5, undefined, 0.05),
      n("invMass", ["Massa inversa", "Inverse mass"], 0.5, undefined, 0.1),
      n("damping", ["Amortecimento", "Damping"], 0.96, undefined, 0.001),
      n("acceleration", ["Aceleração", "Acceleration"], 0.1, undefined, 0.01),
      n("kickingAcceleration", ["Acel. chutando", "Kicking accel."], 0.07, ["Aceleração enquanto segura o chute.", "Acceleration while holding kick."], 0.01),
      n("kickingDamping", ["Amort. chutando", "Kicking damping"], 0.96, ["Amortecimento enquanto segura o chute.", "Damping while holding kick."], 0.001),
      n("kickStrength", ["Força do chute", "Kick strength"], 5, undefined, 0.5),
      n("kickback", ["Recuo do chute", "Kickback"], 0, undefined, 0.5),
      f("gravity", ["Gravidade", "Gravity"], "vec", { def: [0, 0] }),
      flags("cGroup", ["Grupos extras (cGroup)", "Extra groups (cGroup)"], [], ["Somados aos grupos do time.", "Added to the team's collision groups."]),
    ],
  },
];

export const BALL_FIELDS: FieldDef[] = [
  trait,
  n("radius", ["Raio", "Radius"], 10),
  f("color", ["Cor", "Color"], "color", { def: "FFFFFF" }),
  n("invMass", ["Massa inversa (invMass)", "Inverse mass (invMass)"], 1, undefined, 0.1),
  n("damping", ["Amortecimento", "Damping"], 0.99, undefined, 0.001),
  bCoef(0.5),
  f("gravity", ["Gravidade", "Gravity"], "vec", { def: [0, 0] }),
  cMask,
  flags("cGroup", ["Grupos (cGroup)", "Groups (cGroup)"], ["ball"], ["kick e score são sempre somados à bola.", "kick and score are always added to the ball."]),
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
  get ball() {
    return tr("bola", "ball");
  },
  red: "red",
  blue: "blue",
  redKO: "redKO",
  blueKO: "blueKO",
  get wall() {
    return tr("parede", "wall");
  },
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

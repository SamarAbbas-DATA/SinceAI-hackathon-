import { useStore, newId } from "./store";
import { Num, Text, Select, Check, Section, Btn, KV, Slider, Icon } from "./fields";
import { FindingRow } from "./panels";
import { SPACE_TYPES, FIRE_RATINGS, TANK_CONTENTS, pairKey, type FireRating, type SpaceType, type Design, type Door, type TransverseBulkhead, type LSA } from "../engine/types";
import { sharedEdges, OUTSIDE, overlapsWith } from "../engine/topology";
import { requiredMinutes, RULES } from "../engine/rules";
import { sortedDecks, OUTFIT_KG_PER_M2, LIQUID_DENSITY, TANK_STRUCTURE_FACTOR, spaceVertical } from "../engine/vessel";
import { autoDoors } from "../engine/generators";
import { TYPE_LABEL, TYPE_COLOR, TYPE_ICON } from "./theme";
import { focusOn } from "./three/Viewport";

const RATING_MIN: Record<string, number> = RULES.fire_rating_scale;

export function Inspector() {
  const sel = useStore((s) => s.selection);
  if (!sel) return <EmptyInspector />;
  if (sel.kind === "space") return <SpaceInspector id={sel.id} />;
  if (sel.kind === "door") return <DoorInspector id={sel.id} />;
  if (sel.kind === "lsa") return <LSAInspector id={sel.id} />;
  return <BulkheadInspector id={sel.id} />;
}

function EmptyInspector() {
  return (
    <div className="p-4 text-xs leading-relaxed text-muted">
      <p className="mb-2 text-sm font-medium text-fg">Nothing selected</p>
      <p>Click a space, door, bulkhead or lifeboat in the 3D view to edit it. Pick something in the build bar at the bottom to add new parts.</p>
      <ul className="mt-3 list-disc space-y-1 pl-4">
        <li>Drag a space to move it. Edges snap to neighbours (hold Shift to turn snapping off). A move that would overlap another space is undone.</li>
        <li>Double-click a space to fly the camera to it.</li>
        <li>Arrow keys nudge the selected space by 0.5 m (Shift: 0.1 m).</li>
        <li>Delete removes, Ctrl+D duplicates, Ctrl+Z / Ctrl+Y undo and redo, Esc returns to Select.</li>
      </ul>
    </div>
  );
}

function deckOptions(d: Design) {
  return sortedDecks(d).map((k) => ({ value: k.id, label: `${k.name} (z ${k.z} m)` }));
}

function SpaceInspector({ id }: { id: string }) {
  const design = useStore((s) => s.design);
  const edit = useStore((s) => s.edit);
  const editSpace = useStore((s) => s.editSpace);
  const notify = useStore((s) => s.notify);
  const analysis = useStore((s) => s.analysis);
  const s = design.spaces.find((x) => x.id === id);
  if (!s) return <EmptyInspector />;
  const up = (fn: Parameters<typeof editSpace>[1]) => editSpace(id, fn);
  const byId = new Map(design.spaces.map((x) => [x.id, x]));
  const walls = sharedEdges(design).filter((e) => e.a === id || e.b === id);
  const fz = design.bulkheads.filter((b) => b.kind === "fire_zone");
  const conns = (analysis?.graph.bySpace.get(id) ?? []).map((c) => ({ c, other: c.a === id ? c.b : c.a }));
  const findings = (analysis?.rules ?? []).flatMap((r) => r.findings.filter((f) => f.targets.includes(id)).map((f) => ({ r, f })));
  const geo = (analysis?.geometry ?? []).filter((g) => g.targets.includes(id));
  const route = analysis?.evac?.assignments.get(id);
  const { zBase, height } = spaceVertical(design, s);
  const fsm = analysis?.condition?.freeSurface.find((x) => x.spaceId === id);

  const fixWalls = () =>
    edit((d) => {
      for (const e of walls) {
        const A = byId.get(e.a)!,
          B = byId.get(e.b)!;
        let req = requiredMinutes(A, B);
        if (e.x0 === e.x1 && fz.some((b) => Math.abs(b.x - e.x0) < 0.05)) req = Math.max(req, 60);
        const k = pairKey(A.id, B.id);
        if (req > 0 && RATING_MIN[d.divisions[k] ?? "A-0"] < req) d.divisions[k] = `A-${req}` as FireRating;
      }
    });

  const duplicate = () => {
    const nid = newId("s");
    const copy = { ...structuredClone(s), id: nid, name: `${s.name} copy` };
    for (const dx of [s.length, -s.length, 0, 0]) {
      for (const dy of dx === 0 ? [s.breadth, -s.breadth] : [0]) {
        const probe = { ...copy, xCentre: s.xCentre + dx, yCentre: s.yCentre + dy };
        if (!overlapsWith(design, probe).length) {
          edit((d) => void d.spaces.push(probe));
          useStore.getState().select({ kind: "space", id: nid });
          return;
        }
      }
    }
    notify("No free spot next to this space for a copy.", "error");
  };

  return (
    <div className="anim-rise">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <span className="anim-pop" style={{ color: TYPE_COLOR[s.type] }}>
          <Icon d={TYPE_ICON[s.type]} size={20} stroke={1.4} />
        </span>
        <div className="anim-wipe flex-1">
          <div className="text-[14px] font-medium">{s.name}</div>
          <div className="text-[11px] text-muted">
            {TYPE_LABEL[s.type]}, {(s.length * s.breadth).toFixed(1)} m2, z {zBase.toFixed(1)} to {(zBase + height).toFixed(1)} m
          </div>
        </div>
        <Btn kind="ghost" onClick={() => focusOn(s.xCentre, s.yCentre, zBase + height / 2)} title="Fly camera to this space">
          Focus
        </Btn>
      </div>

      {(findings.length > 0 || geo.length > 0) && (
        <Section title="Problems with this space">
          <div className="space-y-2.5">
            {[...geo.map((f) => ({ r: { title: "Model check" }, f })), ...findings].map(({ r, f }, i) => (
              <div key={i}>
                <FindingRow f={f} i={i} />
                <div className="mt-0.5 pl-3 text-[10px] text-faint">{r.title}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Space"
        right={
          <div className="flex gap-1">
            <Btn onClick={duplicate}>Duplicate</Btn>
            <Btn kind="danger" onClick={() => deleteSelection()}>
              Delete
            </Btn>
          </div>
        }
      >
        <Text label="Name" value={s.name} onChange={(v) => up((t) => void (t.name = v))} />
        <Select
          label="Type"
          value={s.type}
          options={SPACE_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          onChange={(v: SpaceType) =>
            up((t) => {
              t.type = v;
              if (v === "stairwell" && !t.stair) t.stair = { widthMm: 1000, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 };
              if (v === "tank" && !t.tank) t.tank = { content: "fuel", fillPct: 50 };
            })
          }
        />
        <Select label="Deck" value={s.deckId} options={deckOptions(design)} onChange={(v) => up((t) => void (t.deckId = v))} />
        {(s.type === "stairwell" || s.type === "lift") && <Select label="Top deck" value={s.topDeckId ?? s.deckId} options={deckOptions(design)} onChange={(v) => up((t) => void (t.topDeckId = v))} />}
        <Num label="Centre x (from stern)" value={s.xCentre} unit="m" step={0.5} onChange={(v) => up((t) => void (t.xCentre = v))} />
        <Num label="Centre y (port +)" value={s.yCentre} unit="m" step={0.5} onChange={(v) => up((t) => void (t.yCentre = v))} />
        <Num label="Length (x)" value={s.length} unit="m" step={0.5} min={0.3} onChange={(v) => up((t) => void (t.length = v))} />
        <Num label="Breadth (y)" value={s.breadth} unit="m" step={0.5} min={0.3} onChange={(v) => up((t) => void (t.breadth = v))} />
        {s.type !== "tank" && <Num label="Persons" value={s.persons} step={1} min={0} digits={0} onChange={(v) => up((t) => void (t.persons = Math.round(v)))} />}
        <Num label="Outfit load" value={s.outfitKgPerM2 ?? OUTFIT_KG_PER_M2[s.type]} unit="kg/m2" step={10} min={0} digits={0} onChange={(v) => up((t) => void (t.outfitKgPerM2 = v))} />
      </Section>

      {s.type === "tank" && s.tank && (
        <Section title="Tank contents">
          <Select label="Contents" value={s.tank.content} options={TANK_CONTENTS.map((c) => ({ value: c, label: c.replace("_", " ") }))} onChange={(v) => up((t) => void (t.tank!.content = v))} />
          <Slider label="Filling" value={s.tank.fillPct} min={0} max={100} step={1} unit="%" digits={0} onChange={(v) => up((t) => void (t.tank!.fillPct = v))} />
          <KV k="Capacity" v={(s.length * s.breadth * height * TANK_STRUCTURE_FACTOR).toFixed(1)} unit="m3" />
          <KV k="Liquid mass" v={((LIQUID_DENSITY[s.tank.content] * s.length * s.breadth * height * TANK_STRUCTURE_FACTOR * s.tank.fillPct) / 100 / 1000).toFixed(1)} unit="t" />
          <KV k="Free-surface moment" v={fsm ? fsm.fsm.toFixed(1) : "0 (full or empty)"} unit={fsm ? "t.m" : ""} />
          <p className="mt-1 text-[11px] text-muted">A partly filled tank lets liquid shift when the ship heels, which acts like raising the centre of gravity. Keep tanks full or empty where you can.</p>
        </Section>
      )}

      {s.type === "stairwell" && s.stair && (
        <Section title="Stair">
          <Num label="Clear width" value={s.stair.widthMm} unit="mm" step={50} min={300} digits={0} onChange={(v) => up((t) => void (t.stair!.widthMm = v))} />
          <Select
            label="Direction"
            value={s.stair.orientation}
            options={[
              { value: "fore-aft", label: "Fore and aft" },
              { value: "athwartships", label: "Across the ship" },
            ]}
            onChange={(v) => up((t) => void (t.stair!.orientation = v))}
          />
          <Num label="Flights per deck" value={s.stair.flightsPerDeck} step={1} min={1} digits={0} onChange={(v) => up((t) => void (t.stair!.flightsPerDeck = Math.max(1, Math.round(v))))} />
          <Check label="Handrails both sides" value={s.stair.handrailsBothSides} onChange={(v) => up((t) => void (t.stair!.handrailsBothSides = v))} />
          {analysis?.evac?.stairs.find((x) => x.stairId === id) && <KV k="Persons using this stair" v={analysis.evac.stairs.find((x) => x.stairId === id)!.persons} />}
        </Section>
      )}

      <Section title="Walls and fire rating" right={walls.length > 0 && <Btn onClick={fixWalls}>Set all to minimum</Btn>}>
        {walls.length === 0 && <p className="text-xs text-muted">No neighbouring space shares a wall with this one.</p>}
        {walls.map((e, i) => {
          const other = byId.get(e.a === id ? e.b : e.a)!;
          let req = requiredMinutes(s, other);
          const onZone = e.x0 === e.x1 && fz.some((b) => Math.abs(b.x - e.x0) < 0.05);
          if (onZone) req = Math.max(req, 60);
          const k = pairKey(s.id, other.id);
          const cur = design.divisions[k] ?? "A-0";
          const ok = RATING_MIN[cur] >= req;
          return (
            <div key={i} className="flex items-center justify-between gap-2 py-0.5 text-xs">
              <span className="truncate" title={other.name}>
                {other.name} <span className="text-muted">({e.length.toFixed(1)} m)</span>
              </span>
              <span className="flex items-center gap-1">
                {req > 0 && <span className={ok ? "text-ok" : "font-semibold text-bad"}>needs A-{req}</span>}
                <select
                  className="rounded-md border border-line bg-surface-2 px-1 py-0.5"
                  value={cur}
                  onChange={(ev) =>
                    edit((d) => {
                      d.divisions[k] = ev.target.value as FireRating;
                    })
                  }
                >
                  {FIRE_RATINGS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </span>
            </div>
          );
        })}
      </Section>

      <Section
        title="Doors and openings"
        right={
          <Btn
            onClick={() => {
              const doors = autoDoors(design, id);
              if (!doors.length) return notify("No door needed: every neighbouring corridor, stairwell or public space is already connected.", "info");
              edit((d) => void d.doors.push(...doors));
              notify(`Added ${doors.length} door${doors.length > 1 ? "s" : ""}.`, "ok");
            }}
          >
            Auto doors
          </Btn>
        }
      >
        {conns.length === 0 && <p className="text-xs text-bad">No doors. Press "Auto doors" or use the Door tool on a wall.</p>}
        {conns.map(({ c, other }) => (
          <div key={c.id} className="flex justify-between py-0.5 text-xs">
            <span>{c.virtual ? "Open connection" : `Door ${c.widthMm} mm`}</span>
            <span className="text-muted">to {other === OUTSIDE ? "nothing (check its position)" : (byId.get(other)?.name ?? other)}</span>
          </div>
        ))}
      </Section>

      {route && (
        <Section title="Escape route to the assembly station">
          <p className="text-xs">{[s.name, ...route.steps.map((st) => byId.get(st.space)?.name ?? st.space)].join("  >  ")}</p>
          <KV k="Route length" v={route.length.toFixed(1)} unit="m" />
        </Section>
      )}
    </div>
  );
}

function DoorInspector({ id }: { id: string }) {
  const design = useStore((s) => s.design);
  const edit = useStore((s) => s.edit);
  const analysis = useStore((s) => s.analysis);
  const d = design.doors.find((x) => x.id === id);
  if (!d) return <EmptyInspector />;
  const conn = analysis?.graph.conns.find((c) => c.id === id);
  const name = (sid: string) => (sid === OUTSIDE ? "nothing" : (design.spaces.find((s) => s.id === sid)?.name ?? sid));
  const up = (fn: (t: Door) => void) =>
    edit((x) => {
      fn(x.doors.find((q) => q.id === id)!);
    });
  return (
    <Section
      title="Door"
      right={
        <Btn kind="danger" onClick={() => deleteSelection()}>
          Delete
        </Btn>
      }
    >
      <Select label="Deck" value={d.deckId} options={deckOptions(design)} onChange={(v) => up((t) => (t.deckId = v))} />
      <Num label="x" value={d.x} unit="m" step={0.1} onChange={(v) => up((t) => (t.x = v))} />
      <Num label="y" value={d.y} unit="m" step={0.1} onChange={(v) => up((t) => (t.y = v))} />
      <Num label="Clear width" value={d.widthMm} unit="mm" step={50} min={500} digits={0} onChange={(v) => up((t) => (t.widthMm = v))} />
      <p className="mt-2 text-xs">{conn && conn.b !== OUTSIDE ? `Connects ${name(conn.a)} and ${name(conn.b)}.` : <span className="text-warn">Not on a wall between two spaces, so it does not count as an exit.</span>}</p>
    </Section>
  );
}

function BulkheadInspector({ id }: { id: string }) {
  const design = useStore((s) => s.design);
  const edit = useStore((s) => s.edit);
  const b = design.bulkheads.find((x) => x.id === id);
  if (!b) return <EmptyInspector />;
  const up = (fn: (t: TransverseBulkhead) => void) =>
    edit((x) => {
      fn(x.bulkheads.find((q) => q.id === id)!);
    });
  return (
    <Section
      title={b.kind === "watertight" ? "Watertight bulkhead" : "Fire zone bulkhead"}
      right={
        <Btn kind="danger" onClick={() => deleteSelection()}>
          Delete
        </Btn>
      }
    >
      <Select
        label="Kind"
        value={b.kind}
        options={[
          { value: "watertight", label: "Watertight" },
          { value: "fire_zone", label: "Fire zone (main vertical zone)" },
        ]}
        onChange={(v) => up((t) => (t.kind = v))}
      />
      <Num label="Position x (from stern)" value={b.x} unit="m" step={0.5} onChange={(v) => up((t) => (t.x = v))} />
      {b.kind === "fire_zone" && <Select label="Fire rating" value={b.rating} options={FIRE_RATINGS.map((r) => ({ value: r, label: r }))} onChange={(v) => up((t) => (t.rating = v))} />}
      <p className="mt-2 text-[11px] text-muted">
        {b.kind === "watertight" ? "Watertight bulkheads split the hull into compartments for the flooding check. They run from the keel to the bulkhead deck." : "Fire zone bulkheads split the ship into main vertical zones on every deck. Each zone should stay under 40 m."}
      </p>
    </Section>
  );
}

function LSAInspector({ id }: { id: string }) {
  const design = useStore((s) => s.design);
  const edit = useStore((s) => s.edit);
  const l = design.lsa.find((x) => x.id === id);
  if (!l) return <EmptyInspector />;
  const up = (fn: (t: LSA) => void) =>
    edit((x) => {
      fn(x.lsa.find((q) => q.id === id)!);
    });
  return (
    <Section
      title={l.kind === "lifeboat" ? "Lifeboat" : "Liferaft"}
      right={
        <Btn kind="danger" onClick={() => deleteSelection()}>
          Delete
        </Btn>
      }
    >
      <Select label="Deck" value={l.deckId} options={deckOptions(design)} onChange={(v) => up((t) => (t.deckId = v))} />
      <Num label="x" value={l.x} unit="m" step={0.5} onChange={(v) => up((t) => (t.x = v))} />
      <Num label="y (port +)" value={l.y} unit="m" step={0.5} onChange={(v) => up((t) => (t.y = v))} />
      <Num label="Capacity" value={l.capacity} unit="persons" step={5} min={1} digits={0} onChange={(v) => up((t) => (t.capacity = Math.round(v)))} />
      <Num label="Mass incl. davit" value={l.massT} unit="t" step={0.1} min={0} onChange={(v) => up((t) => (t.massT = v))} />
      <p className="mt-2 text-[11px] text-muted">Side: {l.y >= 0 ? "port" : "starboard"}. Lifeboats count towards the capacity of their side.</p>
    </Section>
  );
}

export function deleteSelection() {
  const st = useStore.getState();
  const sel = st.selection;
  if (!sel) return;
  st.edit((d) => {
    if (sel.kind === "space") {
      d.spaces = d.spaces.filter((s) => s.id !== sel.id);
      for (const k of Object.keys(d.divisions)) if (k.split("|").includes(sel.id)) delete d.divisions[k];
    } else if (sel.kind === "door") d.doors = d.doors.filter((x) => x.id !== sel.id);
    else if (sel.kind === "lsa") d.lsa = d.lsa.filter((x) => x.id !== sel.id);
    else d.bulkheads = d.bulkheads.filter((x) => x.id !== sel.id);
  });
  st.select(null);
}

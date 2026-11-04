import { Orbit, soiRadius } from './orbit.ts';
import type { BodyData, SystemPack } from './types.ts';
import { add, sub, type Vec3 } from './vec3.ts';

export interface Body {
  readonly data: BodyData;
  readonly id: string;
  readonly name: string;
  readonly parent: Body | null;
  readonly children: Body[];
  readonly radius: number;
  readonly mu: number;
  /** Sphere of influence, metres. Infinity for the root body. */
  readonly soi: number;
  readonly orbit: Orbit | null;
  /** Depth in the hierarchy; root is 0. */
  readonly depth: number;
}

/** A loaded planetary system: bodies indexed and linked, orbits built, SOIs derived. */
export class PlanetarySystem {
  readonly pack: SystemPack;
  readonly root: Body;
  readonly home: Body;
  readonly bodies: Body[];
  private readonly byId = new Map<string, Body>();

  constructor(pack: SystemPack) {
    this.pack = pack;
    const dataById = new Map(pack.bodies.map((b) => [b.id, b]));
    if (dataById.size !== pack.bodies.length) throw new Error(`Duplicate body id in pack ${pack.id}`);

    const build = (data: BodyData, parent: Body | null): Body => {
      if (this.byId.has(data.id)) throw new Error(`Cycle at body ${data.id}`);
      let orbit: Orbit | null = null;
      let soi = Infinity;
      if (parent) {
        if (!data.orbit) throw new Error(`Body ${data.id} has a parent but no orbit`);
        orbit = new Orbit(data.orbit, parent.mu);
        soi = data.physical.soi ?? soiRadius(data.orbit.semiMajorAxis, data.physical.gravParameter, parent.mu);
      }
      const body: Body = {
        data,
        id: data.id,
        name: data.name,
        parent,
        children: [],
        radius: data.physical.radius,
        mu: data.physical.gravParameter,
        soi,
        orbit,
        depth: parent ? parent.depth + 1 : 0,
      };
      this.byId.set(data.id, body);
      parent?.children.push(body);
      for (const child of pack.bodies.filter((b) => b.parent === data.id)) build(child, body);
      return body;
    };

    const rootData = dataById.get(pack.rootBody);
    if (!rootData || rootData.parent !== null) throw new Error(`Root body ${pack.rootBody} missing or has a parent`);
    this.root = build(rootData, null);
    for (const b of pack.bodies) if (!this.byId.has(b.id)) throw new Error(`Body ${b.id} is not connected to the root`);

    // Children sorted by orbit size, like the in-game list.
    for (const b of this.byId.values()) b.children.sort((x, y) => x.orbit!.a - y.orbit!.a);
    this.bodies = [];
    const walk = (b: Body) => {
      this.bodies.push(b);
      b.children.forEach(walk);
    };
    walk(this.root);
    this.home = this.get(pack.homeBody);
  }

  get(id: string): Body {
    const b = this.byId.get(id);
    if (!b) throw new Error(`Unknown body ${id}`);
    return b;
  }

  find(id: string): Body | undefined {
    return this.byId.get(id);
  }

  /** Position relative to the root body at UT `t`. */
  absolutePosition(body: Body, t: number): Vec3 {
    let p: Vec3 = [0, 0, 0];
    for (let b: Body | null = body; b?.orbit; b = b.parent) p = add(p, b.orbit.positionAt(t));
    return p;
  }

  /** Position of `body` relative to `origin` at UT `t` (float64, for a floating origin). */
  relativePosition(body: Body, origin: Body, t: number): Vec3 {
    return sub(this.absolutePosition(body, t), this.absolutePosition(origin, t));
  }

  /** Ancestors from the parent up to the root. */
  ancestors(body: Body): Body[] {
    const out: Body[] = [];
    for (let b = body.parent; b; b = b.parent) out.push(b);
    return out;
  }

  /** Radius of the region worth showing around a body: furthest child apoapsis, else its SOI. */
  extent(body: Body): number {
    const maxChild = Math.max(0, ...body.children.map((c) => c.orbit!.apoapsis + Math.min(c.soi, c.orbit!.a)));
    if (maxChild > 0) return maxChild;
    return Number.isFinite(body.soi) ? body.soi : body.radius * 10;
  }
}

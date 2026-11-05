// Minimal typings for the vendored vessel.js module. The library is plain JS; we type only what we call.
/* eslint-disable @typescript-eslint/no-explicit-any */
export declare class Ship {
  constructor(spec: any);
  structure: { hull: Hull; decks: any; bulkheads: any; getWeight(state: any): Weight };
  baseObjects: Record<string, any>;
  derivedObjects: Record<string, any>;
  designState: any;
  getWeight(state?: any): Weight;
  calculateDraft(state?: any, epsilon?: number, rho?: number): number;
  calculateStability(state?: any): any;
  getSpecification(): any;
}
export interface Weight { mass: number; cg: { x: number; y: number; z: number } }
export declare class Hull {
  attributes: any;
  halfBreadths: { stations: number[]; waterlines: number[]; table: (number | null)[][] };
  getStation(x: number): (number | null)[];
  getWaterline(z: number): (number | null)[];
  waterlineCalculation(z: number, bounds?: { minX?: number; maxX?: number; minY?: number; maxY?: number }): any;
  stationCalculation(x: number, maxZ?: number): any;
  calculateAttributesAtDraft(T: number): any;
  calculateDraftAtMass(M: number, epsilon?: number, rho?: number): number;
  getWeight(state: any): Weight;
}
export declare class ShipState { constructor(spec?: any); discrete: any; calculationParameters: any; version: number }
export declare class WaveCreator {
  constructor(defList?: number[][], waveDuration?: number);
  waveDef: any; version: number;
  setWaveDef(freq: number, amp: number, heading: number): void;
}
export declare class WaveMotion { constructor(ship: Ship, states: any, wavCre: WaveCreator, position?: number, critDampPercentage?: number); [k: string]: any }
export declare class HullResistance { constructor(ship: Ship, states: any, propeller: any, wavCre: WaveCreator); [k: string]: any }
export declare const f: { linearFromArrays(xx: number[], yy: number[], x: number): number; bisectionSearch(a: number[], v: number): { index: number; mu: number } };

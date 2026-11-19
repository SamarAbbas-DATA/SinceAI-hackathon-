/**
 * Every threshold the checks use, in one place, with where it comes from.
 * IS Code values are IMO Intact Stability Code 2008 (Res. MSC.267(85)), Part A, 2.2 general criteria,
 * applied to the full-scale equivalent of the model (lengths x lambda, areas x lambda).
 * Model and print values are workshop practice for small FDM test models, not regulations.
 */
export const LIMITS = {
  isCode: {
    source: "IMO IS Code 2008, Part A 2.2",
    area30: 0.055, // m rad, area under GZ 0-30 deg
    area40: 0.09, // m rad, 0-40 deg
    area3040: 0.03, // m rad, 30-40 deg
    gz30: 0.2, // m, GZ at 30 deg or more
    maxGzAngle: 25, // deg, angle of maximum GZ at least
    gm0: 0.15, // m, initial metacentric height
  },
  model: {
    freeboardWarn: 0.2, // share of depth left above water at the lowest end
    freeboardBad: 0.08,
    trimWarn: 0.01, // (Tf - Ta) / L
    trimBad: 0.03,
    reserveWarn: 0.3, // reserve buoyancy share
  },
  print: {
    overhangDeg: 45, // steeper down-facing surfaces need support
    overhangWarn: 0.02, // share of surface needing support before we warn
    minWallLines: 3, // walls thinner than this many lines tend to weep water into the infill
    minFeatureLines: 2, // thinnest printed feature, in line widths
    stepVolumeTol: 0.01, // STEP solid vs mesh volume
  },
};

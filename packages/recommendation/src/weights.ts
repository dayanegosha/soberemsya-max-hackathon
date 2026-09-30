/** Hard constraints are checked first. Majority interest coverage is the main soft objective. */
export const SCORING_WEIGHTS = Object.freeze({
  consensus: 0.5,
  interest: 0.2,
  affordability: 0.15,
  proximity: 0.1,
  timeFit: 0.05,
});

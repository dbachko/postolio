import { LimitsView } from './limits/limits-view';
import { useLimitsData } from './limits/use-limits-data';

export default function Limits() {
  const data = useLimitsData();

  return (
    <LimitsView
      limits={data.limits}
      perBrand={data.perBrand}
      effectiveTier={data.effectiveTier}
      isLimitsLoading={data.isLimitsLoading}
      isPerBrandLoading={data.isPerBrandLoading}
    />
  );
}

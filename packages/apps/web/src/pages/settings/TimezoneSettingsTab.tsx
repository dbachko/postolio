import BrandImageProviderCard from './BrandImageProviderCard';
import BrandTimezoneCard from './BrandTimezoneCard';
import {
  CalendarPreferencesCard,
  UserTimezoneCard,
} from './timezone-settings/timezone-settings-sections';
import { useTimezoneSettingsState } from './timezone-settings/use-timezone-settings-state';

export default function TimezoneSettingsTab() {
  const state = useTimezoneSettingsState();

  return (
    <div className="space-y-6">
      <UserTimezoneCard
        timezone={state.timezone}
        detectedTimezone={state.detectedTimezone}
        localTimezone={state.localTimezone}
        autoDetect={state.autoDetect}
        isSaving={state.isSaving}
        onTimezoneChange={state.handleTimezoneChange}
        onAutoDetectToggle={state.handleAutoDetectToggle}
        onSave={state.handleSaveSettings}
        onReset={state.handleResetToDefault}
      />

      {state.selectedBrand ? (
        <BrandTimezoneCard
          brandName={state.selectedBrand.name}
          brandTimezone={state.brandTimezone}
          isSaving={state.isSaving}
          onBrandTimezoneChange={state.setBrandTimezone}
          onSave={state.handleSaveBrandTimezone}
        />
      ) : null}

      {state.selectedBrand ? (
        <BrandImageProviderCard
          brandName={state.selectedBrand.name}
          selectedProvider={state.brandImageProvider}
          isSaving={state.isSaving}
          onProviderChange={state.setBrandImageProvider}
          onSave={state.handleSaveBrandImageProvider}
        />
      ) : null}

      <CalendarPreferencesCard
        weekStart={state.weekStart}
        isSaving={state.isSaving}
        onWeekStartChange={state.setWeekStart}
        onSave={state.handleSaveWeekStart}
      />
    </div>
  );
}

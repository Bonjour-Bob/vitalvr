import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useLocalization } from '@fluent/react';
import { CheckBox } from '@/components/commons/Checkbox';
import { Dropdown } from '@/components/commons/Dropdown';
import { NumberSelector } from '@/components/commons/NumberSelector';
import { Typography } from '@/components/commons/Typography';
import { Button } from '@/components/commons/Button';
import { SparkleIcon } from '@/components/commons/icon/SparkleIcon';
import { SettingsPagePaneLayout } from '@/components/settings/SettingsPagePaneLayout';
import { SettingRow, SettingsGroup } from '@/components/settings/SettingRow';
import { defineSettingsPage } from '@/components/settings/settings-definitions';
import { useProfiles } from '@/hooks/profiles';
import {
  ACTIVITIES,
  Activity,
  AUTO_MODES_DEFAULTS,
  AutoModesSettings as Settings,
  autoModes,
  useAutoModes,
} from '@/v21/auto-modes';

// VitalVR: settings of the automatic modes (v21/auto-modes.ts)
export const autoModesSettingsPage = defineSettingsPage({
  path: 'auto-modes',
  title: 'settings-auto_modes',
  groups: {
    main: {
      title: 'settings-auto_modes-main',
      description: 'settings-auto_modes-main-description',
      rows: {
        enabled: {
          title: 'settings-auto_modes-enabled',
          description: 'settings-auto_modes-enabled-description',
        },
      },
    },
    profiles: {
      title: 'settings-auto_modes-profiles',
      description: 'settings-auto_modes-profiles-description',
      rows: {
        normal: { title: 'settings-auto_modes-activity-normal' },
        dance: { title: 'settings-auto_modes-activity-dance' },
        lapdance: { title: 'settings-auto_modes-activity-lapdance' },
        bed: { title: 'settings-auto_modes-activity-bed' },
      },
    },
    tuning: {
      title: 'settings-auto_modes-tuning',
      rows: {
        sensitivity: {
          title: 'settings-auto_modes-sensitivity',
          description: 'settings-auto_modes-sensitivity-description',
        },
        delay: {
          title: 'settings-auto_modes-delay',
          description: 'settings-auto_modes-delay-description',
        },
        manualPauseMinutes: {
          title: 'settings-auto_modes-manual_pause',
          description: 'settings-auto_modes-manual_pause-description',
        },
      },
    },
  },
});

const NO_SWITCH = '-';

type Form = Omit<Settings, 'profiles'> & { profiles: Record<Activity, string> };

export function AutoModesSettings() {
  const { l10n } = useLocalization();
  const auto = useAutoModes();
  const profiles = useProfiles();
  const toForm = (s: Settings): Form => ({
    ...s,
    profiles: Object.fromEntries(
      ACTIVITIES.map((a) => [a, s.profiles[a] || NO_SWITCH])
    ) as Record<Activity, string>,
  });
  const { control, watch, handleSubmit, reset } = useForm<Form>({
    defaultValues: toForm(auto.settings),
  });

  useEffect(() => {
    const subscription = watch(() =>
      handleSubmit((values) =>
        autoModes.setSettings({
          ...values,
          profiles: Object.fromEntries(
            ACTIVITIES.map((a) => [
              a,
              values.profiles[a] === NO_SWITCH ? '' : values.profiles[a],
            ])
          ) as Record<Activity, string>,
        })
      )()
    );
    return () => subscription.unsubscribe();
  }, []);

  const items = [
    {
      value: NO_SWITCH,
      label: l10n.getString('settings-auto_modes-no_switch'),
    },
    ...(profiles?.settings.names ?? []).map((name) => ({
      value: name,
      label: name,
    })),
  ];
  const activityName = (a: Activity) =>
    l10n.getString('settings-auto_modes-activity-' + a);
  const paused = Date.now() < auto.pausedUntil;
  const { main, profiles: profileGroup, tuning } = autoModesSettingsPage.groups;

  return (
    <form className="w-full">
      <SettingsPagePaneLayout
        icon={<SparkleIcon />}
        title={autoModesSettingsPage.title}
      >
        <div className="flex flex-col">
          <SettingsGroup group={main}>
            <SettingRow
              setting={main.rows.enabled}
              controlId="auto-modes-enabled"
              control={
                <CheckBox
                  variant="toggle"
                  control={control}
                  name="enabled"
                  id="auto-modes-enabled"
                />
              }
            />
            <div className="flex flex-col gap-1 rounded-lg bg-background-60 px-4 py-3 mt-2">
              <Typography>
                {l10n.getString('settings-auto_modes-status', {
                  seen: activityName(auto.seen),
                  activity: activityName(auto.activity),
                })}
              </Typography>
              <Typography color="secondary">
                {l10n.getString('settings-auto_modes-measures', {
                  motion: Math.round(auto.motion),
                  height: Math.round(auto.height * 100),
                })}
              </Typography>
              {paused && (
                <div className="flex items-center gap-3 pt-1">
                  <Typography color="secondary">
                    {l10n.getString('settings-auto_modes-paused', {
                      minutes: Math.ceil(
                        (auto.pausedUntil - Date.now()) / 60000
                      ),
                    })}
                  </Typography>
                  <Button
                    variant="secondary"
                    onClick={() => autoModes.resume()}
                  >
                    {l10n.getString('settings-auto_modes-resume')}
                  </Button>
                </div>
              )}
            </div>
          </SettingsGroup>

          <SettingsGroup group={profileGroup}>
            {ACTIVITIES.map((activity) => (
              <SettingRow
                key={activity}
                setting={profileGroup.rows[activity]}
                control={
                  <Dropdown
                    control={control}
                    name={`profiles.${activity}`}
                    placeholder={activityName(activity)}
                    items={items}
                    direction="down"
                  />
                }
              />
            ))}
          </SettingsGroup>

          <SettingsGroup group={tuning}>
            <SettingRow
              setting={tuning.rows.sensitivity}
              controlWidth="wide"
              control={
                <NumberSelector
                  control={control}
                  name="sensitivity"
                  min={0.5}
                  max={2}
                  step={0.1}
                  valueLabelFormat={(v) => `×${v.toFixed(1)}`}
                />
              }
            />
            <SettingRow
              setting={tuning.rows.delay}
              controlWidth="wide"
              control={
                <NumberSelector
                  control={control}
                  name="delay"
                  min={0.5}
                  max={3}
                  step={0.1}
                  valueLabelFormat={(v) => `×${v.toFixed(1)}`}
                />
              }
            />
            <SettingRow
              setting={tuning.rows.manualPauseMinutes}
              controlWidth="wide"
              control={
                <NumberSelector
                  control={control}
                  name="manualPauseMinutes"
                  min={0}
                  max={60}
                  step={1}
                  valueLabelFormat={(v) => `${v} min`}
                />
              }
            />
          </SettingsGroup>
          <div className="flex justify-end pt-2">
            <Button
              variant="tertiary"
              onClick={() => reset(toForm(AUTO_MODES_DEFAULTS))}
            >
              {l10n.getString('settings-auto_modes-defaults')}
            </Button>
          </div>
        </div>
      </SettingsPagePaneLayout>
    </form>
  );
}

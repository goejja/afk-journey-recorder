import { useState } from 'react';
import { api, type Profile } from '../backend.js';
import { withRosterStates } from '../FormationEditor.js';
import type { useAction } from '../hooks/action.js';
import { useNewest } from '../hooks/load.js';
import { useProfileRosters } from '../reader/useProfileRosters.js';
import type { SideProfileBarProps } from './FightTeamsEditor.js';
import type { Draft, PatchReference, Side } from './draft.js';
import { withRosterOpponent } from './OpponentEditor.js';

const playerIdKey = (side: Side) => (side === 'A' ? 'playerIdA' : 'playerIdB');

export interface SideProfilesOptions {
  profiles: Profile[];
  patchReference: PatchReference;
  /** The profile of each side the form opens with (found from the Player IDs of a cloned or edited battle). */
  opening: Record<Side, number | null>;
  /** Changes every draft of the form: the one of an edit form, each team of a new battle. */
  update: (change: (d: Draft) => Draft) => void;
  /** Whether a chosen profile's states replace those of the heroes already placed (a saved battle keeps the states it recorded, ADR 0001). */
  overwrite: boolean;
  /** The form's `run` from `useAction`, so a form that disables Save while it works does so while a Player ID or a profile is saved. */
  run: ReturnType<typeof useAction>['run'];
  onError: (message: string | null) => void;
  /** Offers “New profile…” on each side: asks for the name of the profile to make, or returns nothing when the person gives up. */
  askNewName?: (side: Side) => Promise<string | null | undefined>;
}

/**
 * The profile of each side of a battle in a record form: which one is chosen (and its roster, for heroes placed later), choosing another
 * one (its Player ID goes on the drafts and its roster's states on their heroes), giving a profile its Player ID, and making a profile.
 * `barProps` is what `SideProfileBar` needs.
 */
export function useSideProfiles({ profiles, patchReference, opening, update, overwrite, run, onError, askNewName }: SideProfilesOptions) {
  const [chosenProfile, setChosenProfile] = useState(opening);
  const [profileRoster, setProfileRoster] = useProfileRosters(chosenProfile);
  const newestA = useNewest();
  const newestB = useNewest();
  const newestRoster = { A: newestA, B: newestB };

  /** `known` is a profile just made, which `profiles` does not hold until the page has drawn again. */
  async function chooseProfile(side: Side, id: number | null, known?: Profile) {
    const current = newestRoster[side](); // a roster that arrives after another profile was chosen for this side, or None, is dropped
    const after = known ?? profiles.find((p) => p.id === id);
    setChosenProfile((old) => ({ ...old, [side]: id }));
    // The profile's Player ID goes on the side, and the previous profile's comes off.
    update((d) => ({ ...d, [playerIdKey(side)]: after?.playerId ?? null }));
    if (id === null) return setProfileRoster((old) => ({ ...old, [side]: null }));
    try {
      const roster = await api.heroes(id);
      if (!current()) return;
      setProfileRoster((old) => ({ ...old, [side]: roster }));
      // Heroes already placed on the side take the profile's state.
      update((d) => (side === 'A' ? { ...d, formation: withRosterStates(d.formation, roster, overwrite) } : { ...d, opponent: withRosterOpponent(d.opponent, roster, overwrite) }));
      onError(null);
    } catch (e) {
      if (current()) onError((e as Error).message);
    }
  }

  /** Gives the profile a side holds its Player ID, which the side's records keep (ADR 0006); the side takes it. */
  async function givePlayerId(side: Side, playerId: string) {
    const profile = profiles.find((p) => p.id === chosenProfile[side]);
    if (!profile) return;
    await run(
      () => api.updateProfile(profile.id, { playerId }),
      (updated) => {
        patchReference((old) => ({ profiles: old.profiles.map((p) => (p.id === updated.id ? updated : p)) }));
        update((d) => ({ ...d, [playerIdKey(side)]: updated.playerId }));
        onError(null);
      },
    );
  }

  /** A profile made from the form; the side takes it. It has no Player ID: that is added in Profiles. */
  async function createProfile(side: Side, name: string) {
    await run(
      () => api.createProfile({ name }),
      async (created) => {
        patchReference((old) => ({ profiles: [...old.profiles, created] }));
        await chooseProfile(side, created.id, created);
      },
    );
  }

  const barProps: Pick<SideProfileBarProps, 'profiles' | 'sideProfiles' | 'onSideProfile' | 'onNewProfile' | 'onSetPlayerId'> = {
    profiles,
    sideProfiles: chosenProfile,
    onSideProfile: (side, id) => void chooseProfile(side, id),
    onNewProfile: askNewName
      ? (side) =>
          void askNewName(side).then((name) => {
            if (name) return createProfile(side, name);
          })
      : undefined,
    onSetPlayerId: (side, playerId) => void givePlayerId(side, playerId),
  };

  return { chosenProfile, profileRoster, setProfileRoster, barProps };
}

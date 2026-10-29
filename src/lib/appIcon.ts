import {invoke} from '@tauri-apps/api/core';

export type AppIconPlatform = 'windows' | 'macos' | 'ios' | 'android' | 'web';
export type AppIconPlatforms = Record<AppIconPlatform, boolean>;
export type AppIconInput = {path: string; name: string; width: number; height: number; svg?: string; bytes: number[]};
export type AppIconResult = {outputDirectories: string[]};

/** Mirrors the serde camelCase request accepted by the Rust command. */
export async function createAppIcons(input: AppIconInput, outputDirectory: string, platforms: AppIconPlatforms) {
  return invoke<AppIconResult>('create_app_icons', {
    request: {imageBytes: input.bytes, outputDirectory, platforms, sourceSvg: input.svg ?? null},
  });
}

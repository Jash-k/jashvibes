#!/usr/bin/env node
/**
 * scripts/alias-register.mjs — installs the `@/` resolve hook (see alias-loader.mjs).
 * Used as: node --import ./scripts/alias-register.mjs scripts/live-doctor.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./alias-loader.mjs', pathToFileURL(`${import.meta.dirname}/`));

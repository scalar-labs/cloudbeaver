/*
 * CloudBeaver - Cloud Database Manager
 * Copyright (C) 2020-2023 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */
import type { ICachedResourceMetadata } from '../ICachedResourceMetadata';
import type { ICachedTreeElement } from './ICachedTreeElement';

export type ICachedTreeData<TValue, TMetadata extends ICachedResourceMetadata> = ICachedTreeElement<TValue, TMetadata>;

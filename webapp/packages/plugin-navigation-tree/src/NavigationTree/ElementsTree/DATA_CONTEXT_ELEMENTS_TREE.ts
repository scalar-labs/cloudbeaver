/*
 * CloudBeaver - Cloud Database Manager
 * Copyright (C) 2020-2023 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */
import { createDataContext } from '@cloudbeaver/core-data-context';

import type { IElementsTree } from './useElementsTree';

export const DATA_CONTEXT_ELEMENTS_TREE = createDataContext<IElementsTree | undefined>('elements-tree');

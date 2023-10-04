/*
 * CloudBeaver - Cloud Database Manager
 * Copyright (C) 2020-2023 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */
import { action, makeObservable, observable, untracked } from 'mobx';

import { ConfirmationDialog } from '@cloudbeaver/core-blocks';
import { ConnectionInfoResource, IConnectionExecutionContextInfo } from '@cloudbeaver/core-connections';
import { Bootstrap, injectable } from '@cloudbeaver/core-di';
import { CommonDialogService, DialogueStateResult } from '@cloudbeaver/core-dialogs';
import { NotificationService } from '@cloudbeaver/core-events';
import { ProjectInfoResource } from '@cloudbeaver/core-projects';
import { CachedMapAllKey, resourceKeyList, ResourceKeySimple, ResourceKeyUtils } from '@cloudbeaver/core-resource';
import { getRmResourceKey, IResourceManagerMoveData, ResourceManagerResource } from '@cloudbeaver/core-resource-manager';
import { NetworkStateService, WindowEventsService } from '@cloudbeaver/core-root';
import { LocalStorageSaveService } from '@cloudbeaver/core-settings';
import { createPath, getPathParent, throttle } from '@cloudbeaver/core-utils';
import { NavigationTabsService } from '@cloudbeaver/plugin-navigation-tabs';
import { NavResourceNodeService } from '@cloudbeaver/plugin-navigation-tree-rm';
import { ResourceManagerService } from '@cloudbeaver/plugin-resource-manager';
import { ResourceManagerScriptsService, SCRIPTS_TYPE_ID } from '@cloudbeaver/plugin-resource-manager-scripts';
import { createSqlDataSourceHistoryInitialState, getSqlEditorName, SqlDataSourceService, SqlEditorService } from '@cloudbeaver/plugin-sql-editor';
import { SqlEditorTabService } from '@cloudbeaver/plugin-sql-editor-navigation-tab';

import type { IResourceSqlDataSourceState } from './IResourceSqlDataSourceState';
import { ResourceSqlDataSource } from './ResourceSqlDataSource';
import { SqlEditorTabResourceService } from './SqlEditorTabResourceService';

const RESOURCE_TAB_STATE = 'sql_editor_resource_tab_state';
const SYNC_DELAY = 5 * 60 * 1000;

@injectable()
export class ResourceSqlDataSourceBootstrap extends Bootstrap {
  private readonly dataSourceStateState = new Map<string, IResourceSqlDataSourceState>();

  constructor(
    private readonly connectionInfoResource: ConnectionInfoResource,
    private readonly networkStateService: NetworkStateService,
    private readonly sqlDataSourceService: SqlDataSourceService,
    private readonly commonDialogService: CommonDialogService,
    private readonly navResourceNodeService: NavResourceNodeService,
    private readonly notificationService: NotificationService,
    private readonly resourceManagerService: ResourceManagerService,
    private readonly sqlEditorTabService: SqlEditorTabService,
    private readonly navigationTabsService: NavigationTabsService,
    private readonly resourceManagerResource: ResourceManagerResource,
    private readonly resourceManagerScriptsService: ResourceManagerScriptsService,
    private readonly projectInfoResource: ProjectInfoResource,
    private readonly windowEventsService: WindowEventsService,
    private readonly sqlEditorTabResourceService: SqlEditorTabResourceService,
    private readonly sqlEditorService: SqlEditorService,
    localStorageSaveService: LocalStorageSaveService,
  ) {
    super();
    this.dataSourceStateState = new Map();
    this.focusChangeHandler = throttle(this.focusChangeHandler.bind(this), SYNC_DELAY, false);

    makeObservable<this, 'dataSourceStateState' | 'createState'>(this, {
      createState: action,
      dataSourceStateState: observable,
    });

    localStorageSaveService.withAutoSave(
      RESOURCE_TAB_STATE,
      this.dataSourceStateState,
      () => new Map(),
      map => {
        for (const [key, value] of Array.from(map.entries())) {
          if (
            !['string', 'undefined'].includes(typeof value.resourceKey) ||
            !['string'].includes(typeof value.script) ||
            !['string', 'undefined'].includes(typeof value.baseScript) ||
            isExecutionContextInfoValid(value.executionContext) ||
            isExecutionContextInfoValid(value.baseExecutionContext)
          ) {
            map.delete(key);
          }
        }
        return map;
      },
      this.bindState.bind(this),
      'indexed',
    );
  }

  register(): void | Promise<void> {
    this.windowEventsService.onFocusChange.addHandler(this.focusChangeHandler.bind(this));
    this.resourceManagerResource.onItemDelete.addHandler(this.resourceDeleteHandler.bind(this));
    this.resourceManagerResource.onMove.addHandler(this.resourceMoveHandler.bind(this));

    this.sqlDataSourceService.register({
      key: ResourceSqlDataSource.key,
      getDataSource: (editorId, options) => {
        const dataSource = new ResourceSqlDataSource(
          this.projectInfoResource,
          this.connectionInfoResource,
          this.resourceManagerResource,
          this.sqlEditorService,
          this.createState(editorId, options?.script),
        );

        if (options?.executionContext) {
          dataSource.setExecutionContext(options.executionContext);
        }

        // if (options?.name) {
        //   dataSource.setName(options.name);
        // }

        dataSource.setActions({
          rename: this.rename.bind(this),
          read: this.read.bind(this),
          write: this.write.bind(this),
          getProperties: this.getProperties.bind(this),
          setProperties: this.setProperties.bind(this),
        });

        dataSource.setInfo({
          isReadonly: (dataSource: ResourceSqlDataSource) => {
            if (!dataSource.resourceKey) {
              return true;
            }
            const resourceKey = getRmResourceKey(dataSource.resourceKey);

            untracked(() => this.projectInfoResource.load(CachedMapAllKey));
            const project = this.projectInfoResource.get(resourceKey.projectId);

            return !this.networkStateService.state || !project?.canEditResources;
          },
        });

        return dataSource;
      },
      onDestroy: (_, editorId) => this.deleteState(editorId),
      onUnload: async dataSource => {
        await dataSource.save();
      },
      canDestroy: async (dataSource, editorId) => {
        try {
          await dataSource.save();
        } catch {
          const tab = this.sqlEditorTabService.sqlEditorTabs.find(tab => tab.handlerState.editorId === editorId);
          let name: string | undefined = undefined;

          if (tab) {
            name = getSqlEditorName(tab.handlerState, dataSource);
          }

          const result = await this.commonDialogService.open(ConfirmationDialog, {
            title: 'plugin_sql_editor_navigation_tab_resource_save_script_error_confirmation_title',
            message: 'plugin_sql_editor_navigation_tab_resource_save_script_error_confirmation_message',
            subTitle: name,
            confirmActionText: 'ui_close',
          });

          if (result === DialogueStateResult.Rejected) {
            return false;
          }
        }
        return true;
      },
    });
  }

  load(): void | Promise<void> {}

  private createState(editorId: string, script?: string, resourceKey?: string): IResourceSqlDataSourceState {
    let state = this.dataSourceStateState.get(editorId);

    if (!state) {
      state = observable<IResourceSqlDataSourceState>({
        script: script ?? '',
        baseScript: script ?? '',
        resourceKey,
        history: createSqlDataSourceHistoryInitialState(script),
      });

      this.dataSourceStateState.set(editorId, state);
    }

    return state;
  }

  private deleteState(editorId: string): void {
    this.dataSourceStateState.delete(editorId);
  }

  private async focusChangeHandler(focused: boolean) {
    if (!this.resourceManagerService.enabled) {
      return;
    }

    if (focused) {
      const dataSources = this.sqlDataSourceService.dataSources
        .filter(([, dataSource]) => dataSource instanceof ResourceSqlDataSource)
        .map(([, dataSource]) => dataSource as ResourceSqlDataSource);

      for (const dataSource of dataSources) {
        dataSource.markOutdated();
      }
    }
  }

  private resourceMoveHandler(data: IResourceManagerMoveData) {
    if (!this.resourceManagerService.enabled) {
      return;
    }

    const dataSources = this.sqlDataSourceService.dataSources
      .filter(([, dataSource]) => dataSource instanceof ResourceSqlDataSource)
      .map(([, dataSource]) => dataSource as ResourceSqlDataSource);

    for (const dataSource of dataSources) {
      if (dataSource.resourceKey && dataSource.resourceKey.startsWith(data.from)) {
        dataSource?.setResourceKey(data.to + dataSource.resourceKey.slice(data.from.length));
      }
    }
  }

  private resourceDeleteHandler(keyObj: ResourceKeySimple<string>) {
    if (!this.resourceManagerService.enabled) {
      return;
    }

    const tabs: string[] = [];

    const dataSources = this.sqlDataSourceService.dataSources
      .filter(([, dataSource]) => dataSource instanceof ResourceSqlDataSource)
      .map(([, dataSource]) => dataSource as ResourceSqlDataSource);

    ResourceKeyUtils.forEach(keyObj, key => {
      for (const dataSource of dataSources) {
        if (dataSource.resourceKey && dataSource.resourceKey.startsWith(key)) {
          const tab = this.sqlEditorTabResourceService.getResourceTab(dataSource.resourceKey);

          if (tab) {
            tabs.push(tab.id);
          }
          dataSource.setResourceKey(undefined); // prevent deleted resource refresh
        }
      }
    });

    this.navigationTabsService.closeTabSilent(resourceKeyList(tabs), true);
  }

  private async rename(dataSource: ResourceSqlDataSource, resourceKey: string, name: string): Promise<string> {
    if (!dataSource.projectId) {
      throw new Error('Project ID is not defined');
    }
    if (!this.resourceManagerService.enabled) {
      throw new Error('Resource Manager disabled');
    }

    try {
      name = this.projectInfoResource.getNameWithExtension(dataSource.projectId, SCRIPTS_TYPE_ID, name);
      const newResourceKey = createPath(getPathParent(resourceKey), name);

      await this.navResourceNodeService.move(resourceKey, newResourceKey);
      return newResourceKey;
    } catch (exception) {
      this.notificationService.logException(exception as any, 'plugin_sql_editor_navigation_tab_resource_update_script_error');
      throw exception;
    }
  }

  private async write(dataSource: ResourceSqlDataSource, resourceKey: string, value: string): Promise<void> {
    if (!this.resourceManagerService.enabled) {
      return;
    }

    try {
      await this.navResourceNodeService.write(resourceKey, value);
    } catch (exception) {
      this.notificationService.logException(exception as any, 'plugin_sql_editor_navigation_tab_resource_update_script_error');
      throw exception;
    }
  }

  private async getProperties(dataSource: ResourceSqlDataSource, resourceKey: string): Promise<IConnectionExecutionContextInfo | undefined> {
    try {
      return await this.resourceManagerScriptsService.getExecutionContextInfo(resourceKey);
    } catch (exception) {
      this.notificationService.logException(exception as any, 'plugin_sql_editor_navigation_tab_resource_sync_script_error');
      throw exception;
    }
  }

  private async setProperties(
    dataSource: ResourceSqlDataSource,
    resourceKey: string,
    executionContext: IConnectionExecutionContextInfo | undefined,
  ): Promise<IConnectionExecutionContextInfo | undefined> {
    try {
      return await this.resourceManagerScriptsService.setExecutionContextInfo(resourceKey, executionContext);
    } catch (exception) {
      this.notificationService.logException(exception as any, 'plugin_sql_editor_navigation_tab_resource_update_script_error');
      throw exception;
    }
  }

  private async read(dataSource: ResourceSqlDataSource, resourceKey: string): Promise<string> {
    try {
      const data = await this.navResourceNodeService.read(resourceKey);
      return data;
    } catch (exception) {
      this.notificationService.logException(exception as any, 'plugin_sql_editor_navigation_tab_resource_sync_script_error');
      throw exception;
    }
  }

  private bindState() {
    for (const [editorId, datasource] of this.sqlDataSourceService.dataSources) {
      if (datasource instanceof ResourceSqlDataSource) {
        datasource.bindState(this.createState(editorId));
      }
    }
  }
}

function isExecutionContextInfoValid(executionContext: IConnectionExecutionContextInfo | undefined) {
  return (
    !['undefined', 'object'].includes(typeof executionContext) ||
    !['string', 'undefined'].includes(typeof executionContext?.connectionId) ||
    !['string', 'undefined'].includes(typeof executionContext?.id) ||
    !['string', 'undefined', 'object'].includes(typeof executionContext?.defaultCatalog) ||
    !['string', 'undefined', 'object'].includes(typeof executionContext?.defaultSchema)
  );
}

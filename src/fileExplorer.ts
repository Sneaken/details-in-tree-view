import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { filesize } from "filesize";
import * as dayjs from "dayjs";
import {
  DEFAULT_TIME_TEMPLATE,
  PROJECT,
  SHOW,
  TIME_TEMPLATE,
  SHOW_C_TIME,
  SHOW_M_TIME,
  SHOW_SIZE,
} from "./util/constant";
import _ from "./util";

export class FileStat implements vscode.FileStat {
  constructor(private fsStat: fs.Stats) {}

  get type(): vscode.FileType {
    return this.fsStat.isFile()
      ? vscode.FileType.File
      : this.fsStat.isDirectory()
      ? vscode.FileType.Directory
      : this.fsStat.isSymbolicLink()
      ? vscode.FileType.SymbolicLink
      : vscode.FileType.Unknown;
  }

  get isFile(): boolean | undefined {
    return this.fsStat.isFile();
  }

  get isDirectory(): boolean | undefined {
    return this.fsStat.isDirectory();
  }

  get isSymbolicLink(): boolean | undefined {
    return this.fsStat.isSymbolicLink();
  }

  get size(): number {
    return this.fsStat.size;
  }

  get ctime(): number {
    return this.fsStat.birthtime.getTime();
  }

  get mtime(): number {
    return this.fsStat.mtime.getTime();
  }
}

interface Entry {
  uri: vscode.Uri;
  type: vscode.FileType;
}

type ExplorerConfig = {
  show?: boolean;
  timeTemplate?: string;
  showCTime?: boolean;
  showMTime?: boolean;
  showSize?: boolean;
};

type File = {
  ctime?: string;
  size?: string;
  mtime?: string;
};

export class FileSystemProvider implements vscode.TreeDataProvider<Entry>, vscode.FileSystemProvider {
  private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
  private _onDidChangeTreeData: vscode.EventEmitter<Entry | undefined> = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Entry | undefined> = this._onDidChangeTreeData.event;
  private _data: Record<string, File> = {};
  private _config: ExplorerConfig = {};
  constructor() {
    this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    this._config.show = vscode.workspace.getConfiguration(PROJECT).get<boolean>(SHOW, true);
    this._config.timeTemplate = vscode.workspace
      .getConfiguration(PROJECT)
      .get<string>(TIME_TEMPLATE, DEFAULT_TIME_TEMPLATE);
    this._config.showCTime = vscode.workspace.getConfiguration(PROJECT).get<boolean>(SHOW_C_TIME, true);
    this._config.showMTime = vscode.workspace.getConfiguration(PROJECT).get<boolean>(SHOW_M_TIME, true);
    this._config.showSize = vscode.workspace.getConfiguration(PROJECT).get<boolean>(SHOW_SIZE, true);
  }

  get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
    console.log("onDidChangeFile => ", 3);
    return this._onDidChangeFile.event;
  }

  watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
    console.log("333 => ", 333);
    const watcher = fs.watch(
      uri.fsPath,
      { recursive: options.recursive },
      async (event: string, filename: string | Buffer) => {
        const filepath = path.join(uri.fsPath, _.normalizeNFC(filename.toString()));

        // TODO support excludes (using minimatch library?)

        this._onDidChangeFile.fire([
          {
            type:
              event === "change"
                ? vscode.FileChangeType.Changed
                : (await _.exists(filepath))
                ? vscode.FileChangeType.Created
                : vscode.FileChangeType.Deleted,
            uri: uri.with({ path: filepath }),
          } as vscode.FileChangeEvent,
        ]);
      }
    );

    return { dispose: () => watcher.close() };
  }

  refreshFile(element?: Entry) {
    console.log("3 => ", 3);
    this._onDidChangeTreeData.fire(element); // _onDidChangeFile.fire([{type: vscode.FileChangeType.Changed, uri: element}]);
  }

  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    return this._stat(uri.fsPath);
  }

  async _stat(path: string): Promise<vscode.FileStat> {
    return new FileStat(await _.stat(path));
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    return this._readDirectory(uri);
  }

  async _readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const children = await _.readdir(uri.fsPath);

    const result: [string, vscode.FileType][] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const _path = path.join(uri.fsPath, child);
      const stat = await this._stat(_path);
      if (this._config.show) {
        const data: File = {};
        if (this._config.showCTime) {
          data.ctime = dayjs(stat.ctime).format(this._config.timeTemplate);
        }
        if (this._config.showSize) {
          data.size = filesize(stat.size, { base: 2, standard: "jedec" }) as string;
        }
        if (this._config.showMTime) {
          data.mtime = dayjs(stat.mtime).format(this._config.timeTemplate);
        }
        this._data[_path] = data;
      }

      result.push([child, stat.type]);
    }

    return Promise.resolve(result);
  }

  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    return _.mkdir(uri.fsPath);
  }

  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    return _.readfile(uri.fsPath);
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): void | Thenable<void> {
    return this._writeFile(uri, content, options);
  }

  async _writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const exists = await _.exists(uri.fsPath);
    if (!exists) {
      if (!options.create) {
        throw vscode.FileSystemError.FileNotFound();
      }

      await _.mkdir(path.dirname(uri.fsPath));
    } else {
      if (!options.overwrite) {
        throw vscode.FileSystemError.FileExists();
      }
    }

    return _.writefile(uri.fsPath, content as Buffer);
  }

  delete(uri: vscode.Uri, options: { recursive: boolean }): void | Thenable<void> {
    if (options.recursive) {
      return _.rmrf(uri.fsPath);
    }

    return _.unlink(uri.fsPath);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
    return this._rename(oldUri, newUri, options);
  }

  async _rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    const exists = await _.exists(newUri.fsPath);
    if (exists) {
      if (!options.overwrite) {
        throw vscode.FileSystemError.FileExists();
      } else {
        await _.rmrf(newUri.fsPath);
      }
    }

    const parentExists = await _.exists(path.dirname(newUri.fsPath));
    if (!parentExists) {
      await _.mkdir(path.dirname(newUri.fsPath));
    }

    return _.rename(oldUri.fsPath, newUri.fsPath);
  }

  // tree data provider

  async getChildren(element?: Entry): Promise<Entry[]> {
    if (element) {
      const children = await this.readDirectory(element.uri);
      children.sort((a, b) => {
        if (a[1] === b[1]) {
          if (
            (a[0].startsWith("index.") && b[0].startsWith("index.")) ||
            (!a[0].startsWith("index.") && !b[0].startsWith("index."))
          ) {
            return a[0].localeCompare(b[0]);
          }
          return a[0].startsWith("index.") ? -1 : 1;
        }
        return a[1] === vscode.FileType.Directory ? -1 : 1;
      });
      return children.map(([name, type]) => {
        return {
          uri: vscode.Uri.file(path.join(element.uri.fsPath, name)),
          type,
        };
      });
    }

    const workspaceFolder = (vscode.workspace.workspaceFolders ?? []).filter(
      (folder) => folder.uri.scheme === "file"
    )[0];
    if (workspaceFolder) {
      const children = await this.readDirectory(workspaceFolder.uri);
      children.sort((a, b) => {
        if (a[1] === b[1]) {
          return a[0].localeCompare(b[0]);
        }
        return a[1] === vscode.FileType.Directory ? -1 : 1;
      });
      return children.map(([name, type]) => ({
        uri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, name)),
        type,
      }));
    }

    return [];
  }

  getTreeItem(element: Entry): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.uri,
      element.type === vscode.FileType.Directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    if (element.type === vscode.FileType.File) {
      treeItem.command = { command: "fileExplorer.openFile", title: "Open File", arguments: [element.uri] };
      treeItem.contextValue = "file";
      if (this._config.show) {
        const item = this._data[element.uri.path];
        treeItem.description = [item.ctime, item.size, item.mtime].filter(Boolean).join(", ");
      }
    }
    return treeItem;
  }
}

export class FileExplorer {
  constructor(context: vscode.ExtensionContext) {
    const treeDataProvider = new FileSystemProvider();
    context.subscriptions.push(vscode.window.createTreeView("fileExplorer", { treeDataProvider }));
    vscode.commands.registerCommand("fileExplorer.openFile", (resource) => this.openResource(resource));
  }

  private openResource(resource: vscode.Uri): void {
    vscode.window.showTextDocument(resource);
  }
}

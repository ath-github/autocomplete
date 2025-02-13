const filterMessages = (out: string): string => {
  return out.startsWith("warning:") || out.startsWith("error:")
    ? out.split("\n").slice(1).join("\n")
    : out;
};

const postProcessRemoteBranches: Fig.Generator["postProcess"] = (out) => {
  const output = filterMessages(out);

  if (output.startsWith("fatal:")) {
    return [];
  }

  return output.split("\n").map((elm) => {
    // Trim and remove the remote part of the branch name (origin/, fork/...)
    let name = elm.trim().replace(/\w+\//, "");

    const parts = elm.match(/\S+/g);
    if (parts.length > 1) {
      if (parts[0] === "*") {
        // We are in a detached HEAD state
        if (elm.includes("HEAD detached")) {
          return {};
        }
        // Current branch
        return {
          name: elm.replace("*", "").trim(),
          description: "Current branch",
          priority: 100,
          icon: "⭐️",
        };
      } else if (parts[0] === "+") {
        // Branch checked out in another worktree.
        name = elm.replace("+", "").trim();
      }
    }

    return {
      name,
      description: "Branch",
      icon: "fig://icon?type=git",
      priority: 75,
    };
  });
};

interface RepoDataType {
  isPrivate: boolean;
  nameWithOwner: string;
  description: string | null;
}

const listRepoMapFunction = (repo: RepoDataType) => ({
  name: repo.nameWithOwner,
  description: repo.description,
  //be able to see if the repo is private at a glance
  icon: repo.isPrivate ? "🔒" : "👀",
});

const ghGenerators: Record<string, Fig.Generator> = {
  listCustomRepositories: {
    trigger: "/",
    //execute is script then postProcess
    custom: async (tokens, execute) => {
      //get the last command token
      const last = tokens.pop();

      //gatekeeper
      if (!last) return [];

      /**
       * this turns this input:
       * `withfig/autocomplete`
       *
       * into:
       * ["withfig", "autocomplete"]
       */
      const userRepoSplit = last.split("/");

      // make sure it has some length.
      if (userRepoSplit.length === 0) return [];

      //get first element of arr
      const userOrOrg = userRepoSplit.shift();

      // make sure it has some existence.
      if (!userOrOrg) return [];

      //run `gh repo list` cmd
      const res = await execute(
        `gh repo list ${userOrOrg} --json "nameWithOwner,description,isPrivate" `
      );

      // make sure it has some existence.
      if (!res) return [];

      //parse the JSON string output of the command
      const repoArr: RepoDataType[] = JSON.parse(res);

      return repoArr.map(listRepoMapFunction);
    },
  },
  listRepositories: {
    /*
     * based on the gh api (use this instead as it also returns repos in the orgs that the user is part of)
     * https://cli.github.com/manual/gh_api
     */
    script:
      "gh api graphql --paginate -f query='query($endCursor: String) { viewer { repositories(first: 100, after: $endCursor) { nodes { isPrivate, nameWithOwner, description } pageInfo { hasNextPage endCursor }}}}'",
    postProcess: (out) => {
      interface PageInfo {
        hasNextPage: boolean;
        endCursor: string;
      }

      interface Repositories {
        nodes: RepoDataType[];
        pageInfo: PageInfo;
      }

      interface Viewer {
        repositories: Repositories;
      }

      interface Data {
        viewer: Viewer;
      }

      interface ResObject {
        data: Data;
      }

      if (out) {
        try {
          const fixedOut = out.trim();

          const data: ResObject = JSON.parse(fixedOut);

          return data.data.viewer.repositories.nodes.map(listRepoMapFunction);
        } catch {
          return [];
        }
      }
      return [];
    },
  },
  listPR: {
    script: "gh pr list",
    postProcess: (out) =>
      out.split("\n").map((line) => {
        const { id, name, branch, status } = line.match(
          /^(?<id>[\d]+)\t(?<name>.+)\t(?<branch>.*)\t(?<status>OPEN|DRAFT)$/
        ).groups;
        return {
          name: id,
          displayName: name,
          description: `#${id} | ${branch}`,
          icon: status === "OPEN" ? "✅" : "☑️",
        };
      }),
  },
  listAlias: {
    script: "gh alias list",
    postProcess: (out) => {
      const aliases = out.split("\n").map((line) => {
        const [name, content] = line.split(":");

        return { name: name.trim(), content: content.trim() };
      });

      return aliases.map(({ name, content }) => ({
        name,
        description: `Alias for '${content}'`,
        icon: "fig://icon?type=commandkey",
      }));
    },
  },
  remoteBranches: {
    script:
      "git --no-optional-locks branch -r --no-color --sort=-committerdate",
    postProcess: postProcessRemoteBranches,
  },
};

const ghOptions: Record<string, Fig.Option> = {
  help: { name: "--help", description: "Show help for command" },
  clone: { name: "--clone", description: "Clone the fork {true|false}" },
  confirm: {
    name: ["-y", "--confirm"],
    description: "Skip the confirmation prompt",
  },
  all: {
    name: ["--repo", "-R"],
    description: "Select another repository",
    args: {
      name: "[HOST/]OWNER/REPO",
    },
  },
  env: {
    name: ["-e", "--env"],
    description: "List secrets for an environment",
    args: {
      name: "string",
    },
  },
  org: {
    name: ["-o", "--org"],
    description: "List secrets for an environment",
    args: {
      name: "string",
    },
  },
};

const completionSpec: Fig.Spec = {
  name: "gh",
  description: "GitHub's CLI tool",
  args: {
    name: "alias",
    description: "Custom user defined gh alias",
    isOptional: true,
    generators: ghGenerators.listAlias,
  },
  subcommands: [
    {
      name: "alias",
      description: "Create command shortcuts",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "delete",
          description: "Delete an alias",
          args: {
            name: "alias",
            generators: ghGenerators.listAlias,
          },
          options: [ghOptions.help],
        },
        {
          name: "list",
          description: "List available aliases",
          options: [ghOptions.help],
        },
        {
          name: "set",
          description: "Set an alias for a gh command",
          args: [
            {
              name: "alias",
              description: "A word that will expand to the gh command",
            },
            {
              name: "expansion",
              description:
                "The gh command to be invoked, more info with --help",
            },
          ],
          options: [
            ghOptions.help,
            {
              name: ["-s", "--shell"],
              description:
                "Declare an alias to be passed through a shell interpreter",
            },
          ],
        },
      ],
    },
    { name: "api", description: "Make an authenticated GitHub API request" },
    {
      name: "auth",
      description: "Login, logout, and refresh your authentication",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "login",
          description: "Authenticate with a GitHub host",
          options: [
            ghOptions.help,
            {
              name: ["-h", "--hostname"],
              description:
                "The hostname of the GitHub instance to authenticate with",
              args: { name: "hostname" },
            },
            {
              name: ["-s", "--scopes"],
              description: "Additional authentication scopes for gh to have",
              args: { name: "scopes" },
            },
            {
              name: ["-w", "--web"],
              description: "Open a browser to authenticate",
            },
            {
              name: "--with-token",
              description: "Read token from standard input",
              args: { name: "token" },
            },
          ],
        },
        {
          name: "logout",
          description: "Log out of a GitHub host",
          options: [
            ghOptions.help,
            {
              name: ["-h", "--hostname"],
              description:
                "The hostname of the GitHub instance to authenticate with",
              args: { name: "hostname" },
            },
          ],
        },
        {
          name: "refresh",
          description: "Refresh stored authentication credentials",
          options: [
            ghOptions.help,
            {
              name: ["-h", "--hostname"],
              description:
                "The hostname of the GitHub instance to authenticate with",
              args: { name: "hostname" },
            },
            {
              name: ["-s", "--scopes"],
              description: "Additional authentication scopes for gh to have",
              args: { name: "scopes" },
            },
          ],
        },
        {
          name: "setup-git",
          description: "Configure git to use GitHub CLI as a credential helper",
          options: [
            ghOptions.help,
            {
              name: ["-h", "--hostname"],
              description:
                "The hostname of the GitHub instance to authenticate with",
              args: { name: "hostname" },
            },
          ],
        },
        {
          name: "status",
          description: "View authentication status",
          options: [
            ghOptions.help,
            {
              name: ["-h", "--hostname"],
              description:
                "The hostname of the GitHub instance to authenticate with",
              args: { name: "hostname" },
            },
            {
              name: "--with-token",
              description: "Read token from standard input",
              args: { name: "token" },
            },
          ],
        },
      ],
    },
    {
      name: "gpg-key",
      description: "Manage GPG keys registered with your GitHub account",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "add",
          description: "Add a GPG key to your GitHub account",
          options: [ghOptions.help],
        },
        {
          name: "list",
          description: "Lists GPG keys in your GitHub account",
          options: [ghOptions.help],
        },
      ],
    },
    {
      name: "completion",
      description: "Generate shell completion scripts",
      options: [
        ghOptions.help,
        {
          name: ["-s", "--shell"],
          args: {
            name: "shell",
            suggestions: ["bash", "zsh", "fish", "powershell"],
          },
        },
      ],
    },
    {
      name: "config",
      description: "Manage configuration for gh",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "get",
          description: "Print the value of a given configuration key",
          args: {
            name: "key",
            suggestions: [
              "git_protocol",
              "editor",
              "prompt",
              "pager",
              "http_unix_socket",
            ],
          },
          options: [
            ghOptions.help,
            {
              name: ["-h", "--host"],
              args: { name: "host" },
              description: "Get per-host setting",
            },
          ],
        },
        {
          name: "set",
          description: "Update configuration with a value for the given key",
          subcommands: [
            {
              name: "git_protocol",
              description:
                "The protocol to use for git clone and push operations",
              args: {
                name: "option",
                suggestions: ["https", "ssh"],
              },
            },
            {
              name: "editor",
              description: "The text editor program to use for authoring text",
              args: { name: "editor", suggestions: ["vim", "nano"] },
            },
            {
              name: "prompt",

              description: "Toggle interactive prompting in the terminal",
              args: {
                name: "value",
                suggestions: ["enable", "disable"],
              },
            },
            {
              name: "pager",
              insertValue: "pager {cursor}",
              description:
                "The terminal pager program to send standard output to",
              args: { name: "value" },
            },
            {
              name: "http_unix_socket",
              description:
                "The path to a unix socket through which to make HTTP connection",
              args: { name: "path" },
            },
          ],
          options: [
            ghOptions.help,
            {
              name: ["-h", "--host"],
              args: { name: "host" },
              description: "Get per-host setting",
            },
          ],
        },
      ],
    },
    {
      name: "extensions",
      description: "Manage gh extensions",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "create",
          description: "Create a new extension",
          options: [ghOptions.help],
          args: {
            name: "name",
          },
        },
        {
          name: "install",
          description: "Install a gh extension from a repository",
          options: [ghOptions.help],
          args: {
            name: "repo",
          },
        },
        {
          name: "list",
          description: "List installed extension commands",
          options: [ghOptions.help],
        },
        {
          name: "remove",
          description: "Remove an installed extension",
          options: [ghOptions.help],
          args: {
            name: "name",
          },
        },
        {
          name: "upgrade",
          description: "Upgrade installed extensions",
          options: [
            ghOptions.help,
            { name: "--all", description: "Upgrade all extensions" },
            { name: "--force", description: "Force upgrade extensions" },
          ],
          args: {
            name: "name",
          },
        },
      ],
    },
    {
      name: "gist",
      description: "Manage gists",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "clone",
          description: "Clone a gist locally",
          options: [ghOptions.help],
          args: [
            { name: "gist", description: "Gist ID or URL" },
            { name: "directory", isOptional: true, template: "folders" },
          ],
        },
        {
          name: "create",
          description: "Create a new gist",
          args: {
            name: "filename",
            template: "filepaths",
          },
          options: [
            ghOptions.help,
            {
              name: ["-d", "--desc"],
              description: "A description for this gist",
              insertValue: "-d '{cursor}'",
              args: { name: "description" },
            },
            {
              name: ["-f", "--filename"],
              description:
                "Provide a filename to be used when reading from STDIN",
              args: { name: "filename", template: "filepaths" },
            },
            {
              name: ["-p", "--public"],
              description: "List the gist publicly (default: secret)",
            },
            {
              name: ["-w", "--web"],
              description: "Open the web browser with created gist",
            },
          ],
        },
        {
          name: "delete",
          description: "Delete a gist",
          options: [ghOptions.help],
          args: { name: "gist", description: "Gist ID or URL" },
        },
        {
          name: "edit",
          description: "Edit one of your gists",
          args: { name: "gist", description: "Gist ID or URL" },
          options: [
            ghOptions.help,
            {
              name: ["-a", "--add"],
              description: "Add a new file to the gist",
              args: { name: "filename", template: "filepaths" },
            },
            {
              name: ["-f", "--filename"],
              description: "Select a file to edit",
            },
          ],
        },
        {
          name: "list",
          description: "List your gists",
          options: [
            ghOptions.help,
            {
              name: ["-L", "--limit"],
              displayName: "-L, --limit",
              description: "Maximum number of gists to fetch (default 10)",
              args: { name: "int" },
            },
            {
              name: "--public",
              description: "Show only public gists",
            },
            {
              name: "--secret",
              description: "Show only secret gists",
            },
          ],
        },
        {
          name: "view",
          description: "View a gist",
          args: { name: "gist", description: "Gist ID or URL" },
          options: [
            ghOptions.help,
            {
              name: ["-f", "--filename"],
              description: "Display a single file from the gist",
            },
            {
              name: "--files",
              description: "List file names from the gist",
            },
            {
              name: ["-r", "--raw"],
              description: "Print raw instead of rendered gist contents",
            },
            {
              name: ["-w", "--web"],
              description: "Open gist in the browser",
            },
          ],
        },
      ],
    },
    {
      name: "issue",
      description: "Manage issues",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "close",
          description: "Close issue",
          args: { name: "issue", description: "Number or URL" },
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
          ],
        },
        {
          name: "comment",
          description: "Create a new issue comment",
          args: { name: "issue", description: "Number or URL" },
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
            {
              name: ["-b", "--body"],
              insertValue: "-b '{cursor}'",
              description: "Supply a body. Will prompt for one otherwise",
              args: { name: "string" },
            },
            {
              name: ["-F", "--body-file"],
              description: "Read body text from file",
              args: { name: "file", template: "filepaths" },
            },
            {
              name: ["-e", "--editor"],
              description: "Add body using editor",
              args: { name: "editor" },
            },
            {
              name: ["-w", "--web"],
              description: "Add body in browser",
            },
          ],
        },
        {
          name: "create",
          description: "Create a new issue",
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
            {
              name: ["-a", "--assignee"],
              description:
                'Assign people by their login. Use "@me" to self-assign',
              args: { name: "login" },
            },
            {
              name: ["-b", "--body"],
              insertValue: "-b '{cursor}'",
              description: "Supply a body. Will prompt for one otherwise",
              args: { name: "string" },
            },
            {
              name: ["-F", "--body-file"],
              description: "Read body text from file",
              args: { name: "file", template: "filepaths" },
            },
            {
              name: ["-l", "--label"],
              insertValue: "-l '{cursor}'",
              description: "Add labels by name",
              args: { name: "name" },
            },
            {
              name: ["-m", "--milestone"],
              description: "Add the issue to a milestone by name",
              args: { name: "name" },
            },
            {
              name: ["-p", "--project"],
              insertValue: "-p '{cursor}'",
              description: "Add the issue to projects by name",
              args: { name: "name" },
            },
            {
              name: "--recover",
              insertValue: "--recover '{cursor}'",
              description: "Recover input from a failed run of create",
              args: { name: "string" },
            },
            {
              name: ["-t", "--title"],
              description: "Supply a title. Will prompt for one otherwise",
              insertValue: "-t '{cursor}'",
              args: { name: "string" },
            },
            {
              name: ["-w", "--web"],
              description: "Open the browser to create an issue",
            },
          ],
        },
        {
          name: "delete",
          description: "Delete issue",
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
          ],
        },
        {
          name: "edit",
          description: "Edit an issue",
          args: { name: "issue", description: "Number or URL" },
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
            {
              name: "--add-assignee",
              description:
                'Add assigned users by their login. Use "@me" to assign yourself',
              args: { name: "login" },
            },
            {
              name: "--add-label",
              description: "Add labels by name",
              args: { name: "name" },
            },
            {
              name: ["-b", "--body"],
              insertValue: "-b '{cursor}'",
              description: "Set the new body",
              args: { name: "string" },
            },
            {
              name: ["-F", "--body-file"],
              description: "Read body text from file",
              args: { name: "file", template: "filepaths" },
            },
            {
              name: ["-m", "--milestone"],
              description: "Edit the milestone the issue belongs to by name",
              args: { name: "name" },
            },
            {
              name: "--remove-assignee",
              description:
                'Remove assigned users by their login. Use "@me" to unassign yourself',
              args: { name: "login" },
            },
            {
              name: "--remove-label",
              description: "Remove labels by name",
              args: { name: "name" },
            },
            {
              name: "--remove-project",
              description: "Remove the issue from projects by name",
              args: { name: "name" },
            },
            {
              name: ["-t", "--title"],
              description: "Set the new title",
              insertValue: "-t '{cursor}'",
              args: { name: "string" },
            },
          ],
        },
        {
          name: "list",
          description: "List and filter issues in this repository",
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
            {
              name: ["-a", "--assignee"],
              description: "Filter by assignee",
              args: { name: "string" },
            },
            {
              name: ["-A", "--author"],
              description: "Filter by author",
              args: { name: "string" },
            },
            {
              name: ["-q", "--jq"],
              description: "Filter JSON output using a jq expression",
              args: { name: "expression" },
            },
            {
              name: "--json",
              description: "Output JSON with the specified fields",
              args: { name: "fields" },
            },
            {
              name: ["-l", "--label"],
              insertValue: "-l '{cursor}'",
              description: "Filter by labels",
              args: { name: "string" },
            },
            {
              name: ["-L", "--limit"],
              description: "Maximum number of issues to fetch (default 30)",
              args: { name: "int" },
            },
            {
              name: "--mention",
              description: "Filter by mention",
              args: { name: "string" },
            },
            {
              name: ["-m", "--milestone"],
              insertValue: "-m '{cursor}'",
              description: "Filter by milestone number or `title`",
              args: { name: "number", description: "Number or Title" },
            },
            {
              name: ["-S", "--search"],
              insertValue: "--search '{cursor}'",
              description: "Search issues with query",
              args: { name: "query" },
            },
            {
              name: ["-s", "--state"],
              description: 'Filter by state (default "open")',
              args: {
                name: "state",
                suggestions: ["open", "closed", "all"],
                default: "open",
                description: '(default "open")',
              },
            },
            {
              name: ["-t", "--template"],
              description: "Format JSON output using a Go template",
              args: { name: "string" },
            },
            {
              name: ["-w", "--web"],
              description: "Open the browser to list the issue(s)",
            },
          ],
        },
        {
          name: "reopen",
          description: "Reopen issue",
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
          ],
        },
        {
          name: "status",
          description: "Show status of relevant issues",
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
            {
              name: ["-q", "--jq"],
              description: "Filter JSON output using a jq expression",
              args: { name: "expression" },
            },
            {
              name: "--json",
              description: "Output JSON with the specified fields",
              args: { name: "fields" },
            },
            {
              name: ["-t", "--template"],
              description: "Format JSON output using a Go template",
              args: { name: "string" },
            },
          ],
        },
        {
          name: "transfer",
          description: "Transfer issue to another repository",
          args: [
            { name: "issue", description: "Number or URL" },
            { name: "destination-repo" },
          ],
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
          ],
        },
        {
          name: "view",
          description: "View an issue",
          args: { name: "issue", description: "Number or URL" },
          options: [
            ghOptions.help,
            {
              name: ["-R", "--repo"],
              insertValue: "-R '{cursor}'",
              description:
                "Select another repository using the [HOST/]OWNER/REPO format",
              args: { name: "repo" },
            },
            {
              name: ["-c", "--comments"],
              description: "View issue comments",
            },
            {
              name: ["-q", "--jq"],
              description: "Filter JSON output using a jq expression",
              args: { name: "expression" },
            },
            {
              name: "--json",
              description: "Output JSON with the specified fields",
              args: { name: "fields" },
            },
            {
              name: ["-t", "--template"],
              description: "Format JSON output using a Go template",
              args: { name: "string" },
            },
            {
              name: ["-w", "--web"],
              description: "Open an issue in the browser",
            },
          ],
        },
      ],
    },
    {
      name: "pr",
      description: "Manage pull requests",
      subcommands: [
        {
          name: "checkout",
          description: "Check out a pull request in git",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: "--recurse-submodules",
              description: "Update all active submodules (recursively)",
            },
          ],
        },
        {
          name: "checks",
          description: "Show CI status for a single pull request",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: ["-w", "--web"],
              description: "Open the web browser to show details about checks",
            },
          ],
        },
        {
          name: "close",
          description: "Close a pull request",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: ["-d", "--delete-branch"],
              description: "Delete the local and remote branch after close",
            },
          ],
        },
        {
          name: "edit",
          description:
            "Edit a pull request. Without an argument, the pull request that belongs to the current branch is selected",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: "--add-assignee",
              description:
                'Add assigned users by their login. Use "@me" to assign yourself',
              args: {
                name: "login",
              },
            },
            {
              name: "--add-label",
              description: "Add labels by name",
              args: {
                name: "name",
              },
            },
            {
              name: "--add-project",
              description: "Add the pull request to projects by name",
              args: {
                name: "name",
              },
            },
            {
              name: "--add-reviewer",
              description: "Add reviewers by their login",
              args: {
                name: "login",
              },
            },
            {
              name: ["-B", "--base"],
              description: "Change the base branch for this pull request",
              args: {
                name: "branch",
              },
            },
            {
              name: ["-b", "--body"],
              description: "Set the new body",
              args: {
                name: "string",
              },
            },
            {
              name: ["-F", "--body-file"],
              description:
                'Read body text from file (use "-" to read from standard input)',
              args: {
                name: "file",
              },
            },
            {
              name: ["-m", "--milestone"],
              description:
                "Edit the milestone the pull request belongs to by name",
              args: {
                name: "name",
              },
            },
            {
              name: "--remove-assignee",
              description:
                'Remove assigned users by their login. Use "@me" to unassign yourself',
              args: {
                name: "login",
              },
            },
            {
              name: "--remove-label",
              description: "Remove labels by name",
              args: {
                name: "name",
              },
            },
            {
              name: "--remove-project",
              description: "Remove the pull request from projects by name",
              args: {
                name: "name",
              },
            },
            {
              name: "--remove-reviewer",
              description: "Remove reviewers by their login",
              args: {
                name: "login",
              },
            },
            {
              name: ["-t", "--title"],
              description: "Set the new title",
              args: {
                name: "string",
              },
            },
            ghOptions.help,
            ghOptions.all,
          ],
        },
        {
          name: "comment",
          description: "Create a new pr comment",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: ["-b", "--body"],
              insertValue: "-b '{cursor}'",
              description: "Supply a body. Will prompt for one otherwise",
              args: {
                name: "message",
              },
            },
            { name: ["-e", "--editor"], description: "Add body using editor" },
            { name: ["-w", "--web"], description: "Add body in browser" },
          ],
        },
        {
          name: "create",
          description: "Create a pull request",
          options: [
            {
              name: ["-a", "--assignee"],
              description: "Assign people by their login",
              args: {
                name: "login",
              },
            },
            {
              name: ["-B", "--base"],
              description: "The branch into which you want your code merged",
              args: {
                name: "branch",
                generators: ghGenerators.remoteBranches,
              },
            },
            {
              name: ["-b", "--body"],
              insertValue: "-b '{cursor}'",
              description: "Body for the pull request",
              args: {
                name: "body",
              },
            },
            {
              name: ["-d", "--draft"],
              description: "Mark pull request as a draft",
            },
            {
              name: ["-f", "--fill"],
              description:
                "Do not prompt for title/body and just use commit info",
            },
            {
              name: ["-H", "--head"],
              description:
                "The branch that contains commits for your pull request (default: current branch)",
              args: {
                name: "branch",
              },
            },
            {
              name: ["-l", "--label"],
              description:
                "The branch that contains commits for your pull request (default: current branch)",
              args: {
                name: "branch",
              },
            },
            {
              name: ["-m", "--milestone"],
              description: "Add the pull request to a milestone by name",
              args: {
                name: "name",
              },
            },
            {
              name: "--no-maintainer-edit",
              description:
                "Disable maintainer's ability to modify pull request",
            },
            {
              name: ["-p", "--project"],
              description: "Add the pull request to projects by name",
              args: {
                name: "name",
              },
            },
            {
              name: "-recover",
              description: "Recover input from a failed run of create",
              args: {
                name: "string",
              },
            },
            {
              name: ["-r", "--reviewer"],
              description:
                "Request reviews from people or teams by their handle",
              args: {
                name: "handle",
              },
            },
            {
              name: ["-t", "--title"],
              description: "Title for the pull request",
              args: {
                name: "string",
              },
            },
            {
              name: ["-w", "--web"],
              description: "Open the web browser to create a pull request",
            },
          ],
        },
        {
          name: "diff",
          description: "View changes in a pull request",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: "--color",
              description: "Use color in diff output: {always|never|auto}",
              args: {
                name: "choice",
              },
            },
          ],
        },
        {
          name: "list",
          description: "List and filter pull requests in this repository",
          options: [
            {
              name: ["-a", "--assignee"],
              description: "Filter by assignee",
              args: {
                name: "string",
              },
            },
            {
              name: ["-B", "--base"],
              description: "Filter by base branch",
              args: {
                name: "string",
              },
            },
            {
              name: ["-l", "--label"],
              description: "Filter by labels",
              args: {
                name: "string",
              },
            },
            {
              name: ["-L", "--limit"],
              description: "Maximum number of items to fetch",
              args: {
                name: "int",
              },
            },
            {
              name: ["-s", "--state"],
              description: "Filter by state: {open|closed|merged|all}",
              args: {
                name: "string",
              },
            },
            {
              name: ["-w", "--web"],
              description: "Open the browser to list the pull requests",
              args: {
                name: "string",
              },
            },
          ],
        },
        {
          name: "merge",
          description: "Merge a pull request",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: ["-d", "--delete-branch"],
              description: "Delete the local and remote branch after merge",
            },
            {
              name: ["-m", "--merge"],
              description: "Merge the commits with the base branch",
            },
            {
              name: ["-r", "--rebase"],
              description: "Rebase the commits onto the base branch",
            },
            {
              name: ["-s", "--squash"],
              description:
                "Squash the commits into one commit and merge it into the base branch",
            },
          ],
        },
        {
          name: "ready",
          description: "Mark a pull request as ready for review",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
        },
        {
          name: "reopen",
          description: "Reopen a pull request",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
        },
        {
          name: "review",
          description: "Add a review to a pull request",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            { name: ["-a", "--approve"], description: "Approve pull request" },
            {
              name: ["-b", "--body"],
              description: "Specify the body of a review",
              args: {
                name: "string",
              },
            },
            {
              name: ["-c", "--comment"],
              description: "Comment on a pull request",
            },
            {
              name: ["-r", "--request-changes"],
              description: "Request changes on a pull request",
            },
          ],
        },
        {
          name: "status",
          description: "Show status of relevant pull requests",
        },
        {
          name: "view",
          description: "View a pull request",
          args: {
            name: "number | url | branch",
            generators: ghGenerators.listPR,
          },
          options: [
            {
              name: ["-c", "--comments"],
              description: "View pull request comments",
            },
            {
              name: ["-w", "--web"],
              description: "Open a pull request in the browser",
            },
          ],
        },
      ],
    },
    { name: "release", description: "Manage GitHub releases" },
    {
      name: "repo",
      description: "Work with GitHub repositories",
      subcommands: [
        {
          name: "archive",
          description:
            "Archive a GitHub repository. With no argument, archives the current repository",
          isDangerous: true,
          args: {
            name: "repository",
            generators: ghGenerators.listRepositories,
            isOptional: true,
          },
          options: [ghOptions.help, ghOptions.confirm],
        },
        {
          name: "clone",
          description: `Clone a GitHub repository locally.
If the "OWNER/" portion of the "OWNER/REPO" repository argument is omitted, it
defaults to the name of the authenticating user.
Pass additional 'git clone' flags by listing them after '--'`,
          args: [
            {
              name: "repository",
              generators: [
                ghGenerators.listRepositories,
                ghGenerators.listCustomRepositories,
              ],
            },
            {
              name: "directory",
              isOptional: true,
            },
          ],
          options: [ghOptions.help],
        },
        {
          name: "create",
          description: `Create a new GitHub repository.
To create a repository interactively, use 'gh repo create' with no arguments.
To create a remote repository non-interactively, supply the repository name and one of '--public', '--private', or '--internal'.
Pass '--clone' to clone the new repository locally.
To create a remote repository from an existing local repository, specify the source directory with '--source'. 
By default, the remote repository name will be the name of the source directory. 
Pass '--push' to push any local commits to the new repository`,
          args: {
            name: "name",
          },
          options: [
            ghOptions.help,
            ghOptions.confirm,
            {
              name: ["-d", "--description"],
              description: "Description of the repository",
              args: {
                name: "string",
              },
            },
            {
              name: ["-h", "--homepage"],
              description: "Repository home page URL",
              args: {
                name: "string",
              },
            },
            { name: "--public", description: "Make the repository public" },
            { name: "--private", description: "Make the repository private" },
            {
              name: "--internal",
              description: "Make the repository internal",
            },
            {
              name: "--enable-issues",
              description: "Enable issues in the new repository {true|false}",
            },
            {
              name: "--enable-wiki",
              description: "Enable wiki in the new repository {true|false}",
            },
          ],
        },
        {
          name: "delete",
          description: `Delete a GitHub repository.
With no argument, deletes the current repository. Otherwise, deletes the specified repository.
Deletion requires authorization with the "delete_repo" scope. 
To authorize, run "gh auth refresh -s delete_repo"`,
          isDangerous: true,
          args: {
            name: "repository",
            generators: ghGenerators.listRepositories,
            isOptional: true,
          },
          options: [ghOptions.help, ghOptions.confirm],
        },
        {
          name: "edit",
          description: "Edit repository settings",
          args: {
            name: "repository",
            generators: ghGenerators.listRepositories,
            isOptional: true,
          },
          options: [
            ghOptions.help,
            ghOptions.clone,
            {
              name: "--add-topic",
              description: "Add repository topic",
              args: {
                name: "topic name",
              },
            },
            {
              name: "--allow-forking",
              description: "Allow forking of an organization repository",
            },
            {
              name: "--default-branch",
              description: "Set the default branch name for the repository",
              args: {
                name: "branch name",
              },
            },
            {
              name: "--delete-branch-on-merge",
              description: "Delete head branch when pull requests are merged",
            },
            {
              name: ["-d", "--description"],
              description: "Description of the repository",
              args: {
                name: "description",
              },
            },
            {
              name: "--enable-auto-merge",
              description: "Enable auto-merge functionality",
            },
            {
              name: "--enable-issues",
              description: "Enable issues in the repository",
            },
            {
              name: "--enable-merge-commit",
              description: "Enable merging pull requests via merge commit",
            },
            {
              name: "--enable-projects",
              description: "Enable projects in the repository",
            },
            {
              name: "--enable-rebase-merge",
              description: "Enable merging pull requests via rebase",
            },
            {
              name: "--enable-squash-merge",
              description: "Enable merging pull requests via squashed commit",
            },
            {
              name: "--enable-wiki",
              description: "Enable wiki in the repository",
            },
            {
              name: ["-h", "--homepage"],
              description: "Repository home page URL",
              args: {
                name: "URL",
              },
            },
            {
              name: "--remove-topic",
              description: "Remove repository topic",
              args: {
                name: "topic name",
              },
            },
            {
              name: "--template",
              description:
                "Make the repository available as a template repository",
            },
            {
              name: "--visibility string",
              description:
                "Change the visibility of the repository to {public,private,internal}",
            },
          ],
        },
        {
          name: "fork",
          description: `Create a fork of a repository.
With no argument, creates a fork of the current repository. Otherwise, forks
the specified repository.
By default, the new fork is set to be your 'origin' remote and any existing
origin remote is renamed to 'upstream'. To alter this behavior, you can set
a name for the new fork's remote with --remote-name.
Additional 'git clone' flags can be passed in by listing them after '--'`,
          args: {
            name: "repository",
            generators: [
              ghGenerators.listRepositories,
              ghGenerators.listCustomRepositories,
            ],
          },
          options: [
            ghOptions.help,
            ghOptions.clone,
            {
              name: "--remote",
              description: "Add remote for fork {true|false}",
            },
            {
              name: "--remote-name",
              description:
                'Specify a name for a fork\'s new remote. (default "origin")',
              args: {
                name: "string",
              },
            },
          ],
        },
        {
          name: "list",
          description: `List repositories owned by user or organization.
For more information about output formatting flags, see 'gh help formatting'`,
          args: {
            name: "owner",
            isOptional: true,
          },
          options: [
            ghOptions.help,
            {
              name: "--archived",
              description: "Show only archived repositories",
            },
            { name: "--fork", description: "Show only forked repositories" },
            {
              name: ["-l", "--language"],
              description: "Filter by primary coding language",
            },
            {
              name: ["-L", "--limit"],
              description:
                "Maximum number of repositories to list (default 30)",
              args: {
                name: "string",
              },
            },
            {
              name: "--no-archived",
              description: "Omit archived repositories",
            },
            {
              name: "--private",
              description: "Show only private repositories",
            },
            {
              name: "--public",
              description: "Show only public repositories",
            },
            { name: "--source", description: "Show only non-forks" },

            {
              name: ["-q", "--jq"],
              description: "Filter JSON output using a jq expression",
            },
            {
              name: "--json",
              description: "Output JSON with the specified fields",
            },
            {
              name: ["-t", "--template"],
              description: "Format JSON output using a Go template",
            },
          ],
        },
        {
          name: "rename",
          description: `Rename a GitHub repository.
By default, this renames the current repository; otherwise renames the specified repository`,
          args: {
            name: "new-name",
            isOptional: true,
          },
          options: [ghOptions.help, ghOptions.confirm, ghOptions.all],
        },
        {
          name: "sync",
          description: `Sync destination repository from source repository. Syncing uses the main branch
of the source repository to update the matching branch on the destination
repository so they are equal. A fast forward update will be used execept when the
'--force' flag is specified, then the two branches will
by synced using a hard reset.    
Without an argument, the local repository is selected as the destination repository.
The source repository is the parent of the destination repository by default.
This can be overridden with the '--source' flag`,
          args: {
            name: "destination-repository",
            isOptional: true,
          },
          options: [
            ghOptions.help,
            {
              name: ["-b", "--branch"],
              description: "Branch to sync",
              args: {
                name: "branch name",
                default: "main",
              },
            },
            {
              name: "--force",
              description:
                "Hard reset the branch of the destination repository to match the source repository",
            },
            {
              name: ["-s", "--source"],
              description: "Source repository",
              args: {
                name: "source repository",
              },
            },
          ],
        },
        {
          name: "view",
          description: `Display the description and the README of a GitHub repository.
With no argument, the repository for the current directory is displayed.
With '--web', open the repository in a web browser instead.
With '--branch', view a specific branch of the repository.
For more information about output formatting flags, see 'gh help formatting'`,
          args: {
            name: "repository",
            isOptional: true,
            generators: [
              ghGenerators.listRepositories,
              ghGenerators.listCustomRepositories,
            ],
          },
          options: [
            ghOptions.help,
            {
              name: ["-b", "--branch"],
              description: "View a specific branch of the repository",
              args: {
                name: "string",
              },
            },
            {
              name: ["-w", "--web"],
              description: "Open a repository in the browser",
            },
          ],
        },
      ],
    },
    {
      name: "run",
      description: "View details about workflow runs",
      options: [ghOptions.help, ghOptions.all],
      subcommands: [
        {
          name: "download",
          description: "Download artifacts generated by a workflow run",
          args: {
            name: "run-id",
          },
        },
        {
          name: "list",
          description: "List recent workflow runs",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: ["-L", "--limit"],
              description: "Maximum number of runs to fetch (default 20)",
              args: {
                name: "int",
              },
            },
            {
              name: ["-w", "--workflow"],
              description: "Filter runs by workflow",
              args: {
                name: "string",
              },
            },
          ],
        },
        {
          name: "rerun",
          description: "Rerun a failed run",
          options: [ghOptions.help, ghOptions.all],
          args: {
            name: "run-id",
          },
        },
        {
          name: "view",
          description: "View a summary of a workflow run",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: "--exit-status",
              description: "Exit with non-zero status if run failed",
            },
            {
              name: ["-j", "--job"],
              description: "View a specific job ID from a run",
              args: {
                name: "string",
              },
            },
            {
              name: "--log",
              description: "View full log for either a run or specific job",
            },
            {
              name: "--log-failed",
              description:
                "View the log for any failed steps in a run or specific job",
            },
            {
              name: ["-v", "--verbose"],
              description: "Show job steps",
            },
            {
              name: ["-w", "--web"],
              description: "Open run in the browser",
            },
          ],
          args: {
            name: "run-id",
          },
        },
        {
          name: "watch",
          description: "Watch a run until it completes, showing its progress",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: "--exit-status",
              description: "Exit with non-zero status if run fails",
            },
            {
              name: ["-i", "--interval"],
              description: "Refresh interval in seconds (default 3)",
              args: {
                name: "int",
              },
            },
          ],
        },
      ],
    },
    {
      name: "secret",
      description: "Manage GitHub secrets",
      options: [ghOptions.help, ghOptions.all],
      subcommands: [
        {
          name: "list",
          description:
            "List secrets for a repository, environment, or organization",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: ["-e", "--env"],
              description: "List secrets for an environment",
              args: {
                name: "string",
              },
            },
            {
              name: ["-o", "--org"],
              description: "List secrets for an environment",
              args: {
                name: "string",
              },
            },
          ],
        },
        {
          name: "remove",
          description: "Remove secrets",
          options: [
            ghOptions.help,
            ghOptions.all,
            ghOptions.env,
            ghOptions.org,
          ],
        },
        {
          name: "set",
          description: "Create or update secrets",
          options: [
            ghOptions.help,
            ghOptions.all,
            ghOptions.env,
            ghOptions.org,
            {
              name: ["-b", "--body"],
              description:
                "A value for the secret. Reads from STDIN if not specified",
              args: {
                name: "string",
              },
            },
            {
              name: ["-v", "--visibility"],
              description:
                "Set visibility for an organization secret: all, `private`, or `selected` (default 'private')",
              args: {
                name: "string",
                suggestions: [
                  { name: "private" },
                  {
                    name: "selected",
                  },
                  {
                    name: "all",
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      name: "ssh-key",
      description: "Manage SSH keys",
      options: [ghOptions.help],
      subcommands: [
        {
          name: "add",
          description: "Add an SSH key to your GitHub account",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: ["-t", "--title"],
              description: "Title for the new key",
            },
          ],
          args: {
            name: "<key-file>",
            template: "filepaths",
          },
        },
        {
          name: "list",
          description: "Lists SSH keys in your GitHub account",
          options: [ghOptions.help, ghOptions.all],
        },
      ],
    },
    {
      name: "workflow",
      description: "View details about GitHub Actions workflows",
      options: [ghOptions.help, ghOptions.all],
      subcommands: [
        {
          name: "disable",
          description: "Disable a workflow",
          options: [ghOptions.help, ghOptions.all],
          args: {
            name: "[<workflow-id> | <workflow-name>]",
          },
        },
        {
          name: "enable",
          description: "Enable a workflow",
          options: [ghOptions.help, ghOptions.all],
          args: {
            name: "[<workflow-id> | <workflow-name>]",
          },
        },
        {
          name: "list",
          description: "List workflows",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: ["-a", "--all"],
              description: "Show all workflows, including disabled workflows",
            },
            {
              name: ["-L", "--limit"],
              description: "Show all workflows, including disabled workflows",
              args: {
                name: "int",
                description:
                  "Maximum number of workflows to fetch (default 50)",
              },
            },
          ],
          args: {
            name: "[<workflow-id> | <workflow-name>]",
          },
        },
        {
          name: "run",
          description: "Run a workflow by creating a workflow_dispatch event",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: ["-F", "--field"],
              description:
                "Add a string parameter in key=value format, respecting @ syntax",
              args: {
                name: "key=value",
              },
            },
            {
              name: "--json",
              description: "Read workflow inputs as JSON via STDIN",
            },
            {
              name: ["-f", "--raw-field"],
              description: "Add a string parameter in key=value format",
              args: {
                name: "key=value",
              },
            },
            {
              name: ["-r", "--ref"],
              description:
                "The branch or tag name which contains the version of the workflow file you'd like to run",
              args: {
                name: "string",
              },
            },
          ],
          args: {
            name: "[<workflow-id> | <workflow-name>]",
          },
        },
        {
          name: "view",
          description: "View the summary of a workflow",
          options: [
            ghOptions.help,
            ghOptions.all,
            {
              name: ["-r", "--ref"],
              description:
                "The branch or tag name which contains the version of the workflow file you'd like to view",
              args: {
                name: "string",
              },
            },
            {
              name: ["-w", "--web"],
              description: "Open workflow in the browser",
            },
            {
              name: ["-y", "--yaml"],
              description: "View the workflow yaml file",
            },
          ],
          args: [
            {
              name: "workflow-id",
            },
            {
              name: "workflow-name",
            },
            {
              name: "filename",
              template: "filepaths",
            },
          ],
        },
      ],
    },
  ],
};

export default completionSpec;

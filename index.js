const core = require('@actions/core');
const github = require('@actions/github');
const child_process = require('child_process');
const process = require('process');

// we will use 'git log --pretty=%B######' to show logs,
// and using special string '########' to seperate revisions.
const rev_separator = "#".repeat(27);

function tag_of(title) {
    var known_tags = ['Misc', 'GC', 'MultiTenant', 'JWarmUp', 'RAS', 'JIT', 'JFR', 'Merge', 'Backport', 'Coroutine', 'Wisp'];
    return known_tags.find(tag => title.startsWith("[" + tag + "]"));
}

function check_rev_titile(title) {
    if (tag_of(title) == undefined) {
        console.log("Unkown tag:" + title);
        return 1;
    }
    return 0;
}

// check comment of single revision, git metadata lines are not included
function check_rev_comment(lines) {
    console.log(lines);
    var title = lines[0];
    // check title
    console.log(">> checking title line:" + title);
    if (check_rev_titile(title) != 0) {
        console.log(">> Title check failed");
        core.setFailed("Title check failed:" + title);
        return 1;
    } else {
        console.log(">> Title is OK!");
    }

    // check for mandatory fields
    console.log(">> checking mandatory fields!");
    var mand_fields = ['Summary:', 'Test Plan:', 'Reviewed-by:', 'Issue:'];
    mand_fields.forEach(mf => {
        if (lines.find(l => l.startsWith(mf)) == undefined) {
            console.log("Missing mandatory field:" + mf);
            core.setFailed("Missing mandatory field '" + mf + "' in git log");
            return 1;
        }
    });
    if (lines.find(l => l.includes("alibaba-inc.com")) != undefined) {
        console.log("No alibaba-inc string in commit message");
        return 1;
    }
    console.log(">> All mandatory fields are present");
    return 0;
}

// Run git command in sub-process, show the command string and output string;
function verbose_run(cmd_string) {
    console.log("Executing command: " + cmd_string);
    var out_buf = child_process.execSync(cmd_string, {maxBuffer: Infinity});
    var out_str = out_buf.toString();
    console.log("Output:\n\"\"\"\n" + out_str + "\"\"\"");
    return out_str;
}

// parse output of 'git log --pretty=raw -l1'
function parse_raw_git_log(git_raw_log) {
    var comments = [];
    if (git_raw_log == null) {
        return;
    }

    var arr = git_raw_log.split(rev_separator);
    arr.forEach(function(s) {
        if (s.length > 0) {
            comments.push(s);
        }
    });
    return comments;
};

// Check comments of last N revisions from 'ref'
function check_last_n_revisions(ref_name, nof_revs) {
    console.log("checking last " + nof_revs + " revisions on " + ref_name);

    // retrieve top N revisions, using ######## (8 * #) as separator
    var out_str = verbose_run("git log --pretty=%B%n" + rev_separator + " -n" + nof_revs + " " + ref_name);

    // parsed comments, each element is from one revision
    var comments = parse_raw_git_log(out_str);

    if (comments.length <= 0) {
        core.setFailed("No revision comments is parsed from " + ref_name);
    }

    // check each revision comments
    comments.forEach(com => {
        var cur_comm = [];
        com.split('\n').forEach(line => {
            line = line.trim();
            if (line.length > 0) {
                cur_comm.push(line);
            }
        })
        if (cur_comm.length > 0 && 0 != check_rev_comment(cur_comm)) {
            core.setFailed("Step check comment failed!")
        }
    });
}

function fetch_pull_request_to_local_branch(local_branch) {
    if (github.context.payload.action.endsWith("opened")) {
        // at creation of pull request
        // extract source SHA from the first merge commit
        var out = verbose_run("git log -1 --pretty=%B " + github.context.sha);
        var hashes = [];
        out.split("\n").forEach(l => {
            l = l.trim();
            if (l.startsWith("Merge")) {
                l.split(" ").forEach(w => {
                    // means it is a hash string
                    if (w.length > 24) {
                        hashes.push(w);
                    }
                });
            }
        });
        // fetch the parsed source
        if (hashes[0] == undefined) {
            core.setFailed("Cannot parse the correct source commit HASH!");
        }
        verbose_run("git fetch origin " + hashes[0] + ":" + local_branch);
    } else if (github.context.payload.action === "synchronize") {
        // at modification of pull request
        var remote_ref = github.context.payload.after;
        verbose_run("git fetch origin " + remote_ref + ":" + local_branch);
    } else {
        core.setFailed("Unsupported github action:" + github.context.payload.action);
    }
    verbose_run("git checkout -f " + local_branch);
}

function could_contain_multiple_commits(tag) {
    return 'Merge' === tag || 'Backport' === tag;
}

// check pull requests
function check_pull_requests() {
    if (check_rev_titile(github.context.payload.pull_request.title) != 0) {
        core.setFailed("Pull request title check failed!");
    }
    var tag = tag_of(github.context.payload.pull_request.title);
    //if (!could_contain_multiple_commits(tag) && github.context.payload.pull_request.commits != 1) {
    //    core.setFailed("Each pull request should contain only ONE commit!");
    //}
}

// check the format of specific rev
function check_patch(rev) {
    var out = verbose_run("git show " + rev);
    var ln = 0;
    console.log("Checking patch format:\n");
    out.split("\n").forEach(line => {
        ln = ln + 1;
        console.log(ln + ": " + line);
        // only check for newly added lines
        if (line.startsWith('+') && line.endsWith(" ")) {
            console.log("\ntrailing spaces found!\n");
            core.setFailed("Trailing spaces in line-" + ln + "\n" + line);
        }
    });
}

// help debugging
function show_envs() {
    console.log("Environment variables:\n", process.env);
    console.log("github.context:\n", github.context);
}

function skipCodeFormat(tag) {
    return 'Merge' === tag || 'Backport' === tag;
}

// entry of checker action
function do_check() {
    show_envs();
    try {
        // only trigger for pull_requests
        if (github.context.eventName === 'pull_request') {
            if (github.context.payload.pull_request.title.startsWith("Merge ")) {
              return;
            }
            if (github.context.payload.pull_request.title.startsWith("Revert ")
                && github.context.payload.pull_request.commits == 1) {
              return;
            }
            if ('Backport' === tag_of(github.context.payload.pull_request.title)
                && github.context.payload.pull_request.commits !== 1) {
              // Skip backporting multiple commits (for Wisp)
              return;
            }
            // using a unique name for local branch
            var local_branch = "local_ref_branch_" + Date.now();

            // run checking
            check_pull_requests();
            fetch_pull_request_to_local_branch(local_branch);
            check_last_n_revisions(local_branch, 1);
            var tag = tag_of(github.context.payload.pull_request.title);
            if (!skipCodeFormat(tag)) {
                check_patch(local_branch);
            }
        } else {
            core.setFailed("Can only be triggered on pull_request, current event=" +
                github.context.eventName)
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

// for local testing purpose
function local_testing() {
    show_envs();
    check_last_n_revisions('local_ref_branch1581603361965', 1);
}

// local_testing();
do_check();

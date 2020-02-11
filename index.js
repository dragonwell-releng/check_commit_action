const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');

// we will use 'git log --pretty=%B######' to show logs,
// and using special string '########' to seperate revisions.
const rev_separator = "########";

// check comment of single revision, git metadata lines are not included
function check_rev_comment(lines) {
    console.log(lines);
    var title = lines[0];
    // check title
    console.log(">> checking title line:" + title);
    var known_tags = ['Misc', 'GC', 'MultiTenant', 'JWarmUp', 'RAS'];
    if (known_tags.find(tag => title.startsWith("[" + tag + "]")) == undefined) {
        console.log("Unkown tag:" + title);
        return 1;
    }
    console.log(">> Title is OK!");

    // check for mandatory fields
    console.log(">> checking mandatory fields!");
    var mand_fields = ['Summary:', 'Test Plan:', 'Reviewed-by:', 'Issue:'];
    mand_fields.forEach(mf => {
        if (lines.find(l => l.startsWith(mf)) == undefined) {
            console.log("Missing mandatory field:" + mf);
            return 1;
        }
    });
    console.log(">> All mandatory fields are present");
    return 0;
}

// Run git command in sub-process, show the command string and output string;
function verbose_run(cmd_string) {
    console.log("Executing command: " + cmd_string);
    var out_buf = execSync(cmd_string);
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
    var out_str = verbose_run("git log --pretty=%B" + rev_separator + " -n" + nof_revs + " " + ref_name);

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

// help debugging
function show_envs() {
    console.log(github.context);
}

// entry of checker action
function main() {
    try {
        // only trigger for pull_requests
        if (github.context.eventName === 'pull_request') {
            // using a unique name for local branch
            var local_branch = "local_ref_branch_" + Date.now();
            var remote_ref = github.context.payload.after;

            // fetch pull request to local branch
            verbose_run("git fetch origin " + remote_ref + ":" + local_branch);

            // run checking
            check_last_n_revisions(local_branch, 1);
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
    check_last_n_revisions('local_ref_branch1581603361965', 1);
}

// local_testing();
main();
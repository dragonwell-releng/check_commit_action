const core = require('@actions/core');
const github = require('@actions/github');
const Git = require('git').Git;

// only trigger for pull_requests
try {
    if (github.context.eventName === 'pull_request') {
        console.log("triggered on pull_request!");
    } else {
        core.setFailed("Can only be triggered on pull_request, current event=" +
            github.context.eventName)
    }
} catch (error) {
    core.setFailed(error.message);
}

// parsed comments, each element is from one revision
var comments = [];

// expecting repo checked out under working directory
var git = new Git(github.context.workspace + '/.git');
// retrieve top 1 commit list
git.rev_list({ pretty: 'raw', max_count: 1 },
    github.context.ref,
    function(err, rev_output) {
        if (rev_output == null) {
            return;
        }

        //
        // using git metadata to split revision logs
        // ----
        // commit 8433cb84df4417006698f6449adc49bddc2bc7ee
        // tree 96bac4aa05ae1a819be87031c13325ca0b366cda
        // parent 329cc65c042491a37a26ddf66ea70aaf47971ea0
        // author Chuan Sheng Lu <chuanshenglu@gmail.com> 1581392441 +0800
        // committer Chuan Sheng Lu <chuanshenglu@gmail.com> 1581392908 +0800
        //
        //var arr = rev_output.replace(/commit.+tree.+.+committer.+#/g, "####").split("####");

        var arr = rev_output.split("committer");
        arr.forEach(function(s) {
            if (s.length > 0) {
                s.split('commit').forEach(l => {
                    if (l.length > 0 && -1 == l.search('author')) {
                        comm = l.substr(l.search(/\n/) + 1);
                        comments.push(comm);
                    }
                })
            }
        });
    });

// check comment of single revision, git metadata lines are not included
function check_comment(lines) {
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

// check each revision comments
comments.forEach(com => {
    var cur_comm = [];
    com.split('\n').forEach(line => {
        if (line.length > 0) {
            line = line.trim();
            cur_comm.push(line);
            console.log(line);
        }
    })
    if (0 != check_comment(cur_comm)) {
        core.setFailed("Step check comment failed!")
    }
});
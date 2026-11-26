/* Supplement strace's exec events with the bytes behind FD-only executable names.
 * Preload into a guest-kernel-native strace only. It observes that tracer's own
 * stopped tracees. No system audit, kernel probes or shared mount changes. */
#define _GNU_SOURCE
#include <ctype.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/audit.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <linux/ptrace.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>

static int log_fd = -1;

__attribute__((constructor)) static void open_log(void) {
    const char *path = getenv("CD_ROUTEA_EXECFD_LOG");
    if (path && *path) log_fd = open(path, O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC|O_NOFOLLOW, 0600);
}

static bool numeric(const char *s) {
    if (!*s) return false;
    while (*s && isdigit((unsigned char)*s)) ++s;
    return !*s;
}

/* The ptrace stop keeps the descriptor live while opening it. The hash child
 * receives that open object on stdin, never a possibly reused filename. */
static bool digest(int object, char result[65]) {
    int output[2];
    if (pipe2(output, O_CLOEXEC) != 0) return false;
    pid_t child = fork();
    if (child == 0) {
        if (dup2(object, STDIN_FILENO)<0 || dup2(output[1], STDOUT_FILENO)<0) _exit(126);
        execl("/usr/bin/sha256sum", "sha256sum", (char *)NULL);
        _exit(127);
    }
    close(output[1]);
    char buffer[160] = {0};
    size_t used = 0;
    while (child>0 && used < sizeof(buffer)-1) {
        ssize_t n = read(output[0], buffer+used, sizeof(buffer)-1-used);
        if (n<0 && errno==EINTR) continue;
        if (n<=0) break;
        used += (size_t)n;
    }
    close(output[0]);
    int status;
    if (child<0) return false;
    while (waitpid(child,&status,0)<0) if (errno!=EINTR) return false;
    if (!WIFEXITED(status) || WEXITSTATUS(status)!=0 || used<65 || buffer[64]!=' ') return false;
    for (size_t i=0;i<64;i++) if (!isxdigit((unsigned char)buffer[i])) return false;
    memcpy(result,buffer,64); result[64]=0; return true;
}

static void sample(pid_t pid) {
    struct ptrace_syscall_info info = {0};
    if (log_fd<0 || syscall(SYS_ptrace,PTRACE_GET_SYSCALL_INFO,pid,sizeof(info),&info)<0 ||
        info.op!=PTRACE_SYSCALL_INFO_ENTRY) return;
    bool at = info.entry.nr==SYS_execveat;
    if (!at && info.entry.nr!=SYS_execve) return;
    char name[PATH_MAX] = {0}, filename[PATH_MAX+80];
    struct iovec dest = {name,sizeof(name)-1};
    struct iovec src = {(void *)info.entry.args[at ? 1 : 0],sizeof(name)-1};
    ssize_t n=process_vm_readv(pid,&dest,1,&src,1,0);
    if (n<1 || !memchr(name,0,(size_t)n)) return;
    const char *base=strrchr(name,'/'); base=base ? base+1 : name;
    bool empty=at && !*name && (info.entry.args[4]&AT_EMPTY_PATH);
    if (!empty && !numeric(base)) return;
    if (empty) {
        snprintf(filename,sizeof(filename),"/proc/%d/fd/%d",pid,(int)info.entry.args[0]);
    } else if (strncmp(name,"/proc/self/fd/",14)==0 || strncmp(name,"/proc/thread-self/fd/",21)==0 || strncmp(name,"/dev/fd/",8)==0) {
        snprintf(filename,sizeof(filename),"/proc/%d/fd/%s",pid,base);
    } else if (*name=='/') {
        snprintf(filename,sizeof(filename),"/proc/%d/root%s",pid,name);
    } else if (!at || (int)info.entry.args[0]==AT_FDCWD) {
        snprintf(filename,sizeof(filename),"/proc/%d/cwd/%s",pid,name);
    } else {
        snprintf(filename,sizeof(filename),"/proc/%d/fd/%d/%s",pid,(int)info.entry.args[0],name);
    }
    struct timeval stamp; gettimeofday(&stamp,NULL);
    int object=open(filename,O_RDONLY|O_CLOEXEC|O_NONBLOCK);
    struct stat st = {0}; char hash[65]="", link[PATH_MAX]={0};
    ssize_t length=readlink(filename,link,sizeof(link)-1);
    if (length<0) link[0]=0;
    const char *hint=strrchr(link,'/'); hint=hint?hint+1:link;
    for (char *c=(char *)hint;*c;c++) if (!isalnum((unsigned char)*c) && !strchr(". _-:[]()",*c)) *c='_';
    if (object>=0) {
        if (fstat(object,&st)==0 && S_ISREG(st.st_mode)) (void)digest(object,hash);
        close(object);
    }
    dprintf(log_fd,"{\"pid\":%d,\"time\":\"%lld.%06ld\",\"syscall\":\"%s\",\"kind\":\"%s\",\"size\":%lld,\"hint\":\"%.100s\",\"sha256\":\"%s\"}\n",
            pid,(long long)stamp.tv_sec,(long)stamp.tv_usec,at?"execveat":"execve",empty?"empty":"numeric",(long long)st.st_size,hint,hash);
}

long ptrace(enum __ptrace_request request, ...) {
    static long (*original)(enum __ptrace_request,...);
    if (!original) original=dlsym(RTLD_NEXT,"ptrace");
    va_list ap; va_start(ap,request);
    pid_t pid=va_arg(ap,pid_t); void *addr=va_arg(ap,void *); void *data=va_arg(ap,void *); va_end(ap);
    int saved=errno;
    if (request==PTRACE_SYSCALL) sample(pid);
    errno=saved;
    return original(request,pid,addr,data);
}

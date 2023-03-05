import Syscall from './Syscall'

export default interface SystemInfo {
  openat: Array<Syscall>,
  bind: Array<Syscall>,
  execve: Array<Syscall>
}
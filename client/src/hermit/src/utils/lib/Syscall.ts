export default interface Syscall {
  syscall: string,
  args: Array<any>,
  result: number,
  timing: number,
  pid: number,
  type: string
}

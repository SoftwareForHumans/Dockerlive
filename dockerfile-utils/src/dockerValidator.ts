/* --------------------------------------------------------------------------------------------
 * Copyright (c) Remy Suen. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  Range,
  Position,
  Diagnostic,
  DiagnosticSeverity,
  CodeLens,
  VersionedTextDocumentIdentifier,
} from "vscode-languageserver-types";
import {
  Dockerfile,
  Flag,
  Instruction,
  JSONInstruction,
  Add,
  Arg,
  Cmd,
  Copy,
  Entrypoint,
  From,
  Healthcheck,
  Onbuild,
  ModifiableInstruction,
  PropertyInstruction,
  Property,
  DockerfileParser,
  Directive,
  Keyword,
} from "dockerfile-ast";
import { ValidationCode, ValidationSeverity, ValidatorSettings } from "./main";
import { DynamicAnalysis } from "./dynamicAnalysis";
import Dockerode from "dockerode";
import { TextDocument } from "vscode-languageserver-textdocument";
import checkRepairableProblems from "./repair/main";

export const KEYWORDS = [
  "ADD",
  "ARG",
  "CMD",
  "COPY",
  "ENTRYPOINT",
  "ENV",
  "EXPOSE",
  "FROM",
  "HEALTHCHECK",
  "LABEL",
  "MAINTAINER",
  "ONBUILD",
  "RUN",
  "SHELL",
  "STOPSIGNAL",
  "USER",
  "VOLUME",
  "WORKDIR",
];

export class Validator {
  private docker: Dockerode;

  private document: TextDocument;

  private settings: ValidatorSettings = {
    deprecatedMaintainer: ValidationSeverity.WARNING,
    directiveCasing: ValidationSeverity.WARNING,
    emptyContinuationLine: ValidationSeverity.WARNING,
    instructionCasing: ValidationSeverity.WARNING,
    instructionCmdMultiple: ValidationSeverity.WARNING,
    instructionEntrypointMultiple: ValidationSeverity.WARNING,
    instructionHealthcheckMultiple: ValidationSeverity.WARNING,
    instructionJSONInSingleQuotes: ValidationSeverity.WARNING,
    instructionWorkdirRelative: ValidationSeverity.WARNING,
  };

  private dynamicAnalysis: DynamicAnalysis;

  private dynAnalEnabled: boolean = true;

  constructor(settings?: ValidatorSettings) {
    if (settings) {
      this.settings = settings;
    }

    this.docker = new Dockerode();
  }

  public toggleAnalysis() {
    this.dynAnalEnabled = !this.dynAnalEnabled;
    if (this.dynAnalEnabled) {
      console.log(
        "ENABLED DYNAMIC ANALYSIS - Change the document to trigger a dynamic analysis"
      );
    } else {
      console.log(
        "DISABLED DYNAMIC ANALYSIS - Change the document to trigger a static analysis"
      );
      if (this.dynamicAnalysis) {
        this.dynamicAnalysis.destroy();
      }
    }
  }

  public setSettings(settings: ValidatorSettings) {
    this.settings = settings;
  }

  private checkDirectives(dockerfile: Dockerfile, problems: Diagnostic[]) {
    const duplicatedEscapes = [];
    for (const directive of dockerfile.getDirectives()) {
      if (directive.getDirective() === Directive.escape) {
        duplicatedEscapes.push(directive);
      }
    }

    if (duplicatedEscapes.length > 1) {
      // multiple escape parser directives have been found
      for (const directive of duplicatedEscapes) {
        problems.push(
          Validator.createDuplicatedEscapeDirective(
            directive.getNameRange().start,
            directive.getValueRange().end
          )
        );
      }
      return;
    }

    for (const directive of dockerfile.getDirectives()) {
      const directiveName = directive.getDirective();
      if (directiveName === Directive.escape) {
        const value = directive.getValue();
        if (value !== "\\" && value !== "`" && value !== "") {
          // if the directive's value is invalid or isn't the empty string, flag it
          const range = directive.getValueRange();
          problems.push(
            Validator.createInvalidEscapeDirective(
              range.start,
              range.end,
              value
            )
          );
        }

        if (directive.getName() !== Directive.escape) {
          const range = directive.getNameRange();
          const diagnostic = this.createLowercaseDirective(
            range.start,
            range.end
          );
          if (diagnostic) {
            problems.push(diagnostic);
          }
        }
      }
    }
  }

  /**
   * Checks the arguments of the given instruction.
   *
   * @param instruction the instruction to validate
   * @param problems an array of identified problems in the document
   * @param expectedArgCount an array of expected number of arguments
   *                         for the instruction, if its length is 1
   *                         and its value is -1, any number of
   *                         arguments greater than zero is valid
   * @param validate the function to use to validate an argument
   * @param createIncompleteDiagnostic the function to use to create a diagnostic
   *                                   if the number of arguments is incorrect
   */
  private checkArguments(
    instruction: Instruction,
    problems: Diagnostic[],
    expectedArgCount: number[],
    validate: Function,
    createIncompleteDiagnostic?: Function
  ): void {
    let args =
      instruction instanceof PropertyInstruction
        ? instruction.getPropertyArguments()
        : instruction.getArguments();
    if (args.length === 0) {
      // all instructions are expected to have at least one argument
      let range = instruction.getInstructionRange();
      problems.push(Validator.createMissingArgument(range.start, range.end));
    } else if (expectedArgCount[0] === -1) {
      for (let i = 0; i < args.length; i++) {
        let createInvalidDiagnostic = validate(
          i,
          args[i].getValue(),
          args[i].getRange()
        );
        if (createInvalidDiagnostic) {
          let range = args[i].getRange();
          problems.push(
            createInvalidDiagnostic(range.start, range.end, args[i].getValue())
          );
        }
      }
    } else {
      for (let i = 0; i < expectedArgCount.length; i++) {
        if (expectedArgCount[i] === args.length) {
          for (let j = 0; j < args.length; j++) {
            let range = args[j].getRange();
            let createInvalidDiagnostic = validate(
              j,
              args[j].getValue(),
              range
            );
            if (createInvalidDiagnostic instanceof Function) {
              problems.push(
                createInvalidDiagnostic(
                  range.start,
                  range.end,
                  args[j].getValue()
                )
              );
            } else if (createInvalidDiagnostic !== null) {
              problems.push(createInvalidDiagnostic);
            }
          }
          return;
        }
      }

      let range = args[args.length - 1].getRange();
      if (createIncompleteDiagnostic) {
        problems.push(createIncompleteDiagnostic(range.start, range.end));
      } else {
        problems.push(Validator.createExtraArgument(range.start, range.end));
      }
    }
  }

  private checkVariables(
    instruction: Instruction,
    problems: Diagnostic[]
  ): void {
    for (let variable of instruction.getVariables()) {
      let modifier = variable.getModifier();
      if (modifier !== null) {
        if (instruction.getKeyword() === Keyword.RUN) {
          // allow shell expansions to go through for RUN instructions
          continue;
        } else if (modifier === "") {
          problems.push(
            Validator.createVariableUnsupportedModifier(
              variable.getRange(),
              variable.toString(),
              modifier
            )
          );
        } else if (modifier !== "+" && modifier !== "-") {
          problems.push(
            Validator.createVariableUnsupportedModifier(
              variable.getModifierRange(),
              variable.toString(),
              modifier
            )
          );
        }
      }
    }
  }

  private checkProperty(
    document: TextDocument,
    escapeChar: string,
    keyword: string,
    property: Property,
    firstProperty: boolean,
    optionalValue: boolean,
    problems: Diagnostic[]
  ): void {
    let name = property.getName();
    if (name === "") {
      let range = property.getRange();
      problems.push(
        Validator.createSyntaxMissingNames(range.start, range.end, keyword)
      );
    } else if (name.indexOf("=") !== -1) {
      let nameRange = property.getNameRange();
      let unescapedName = document.getText(nameRange);
      let index = unescapedName.indexOf("=");
      if (unescapedName.charAt(0) === "'") {
        problems.push(
          Validator.createSyntaxMissingSingleQuote(
            nameRange.start,
            document.positionAt(document.offsetAt(nameRange.start) + index),
            unescapedName.substring(0, unescapedName.indexOf("="))
          )
        );
      } else if (unescapedName.charAt(0) === '"') {
        problems.push(
          Validator.createSyntaxMissingDoubleQuote(
            nameRange.start,
            document.positionAt(document.offsetAt(nameRange.start) + index),
            unescapedName.substring(0, unescapedName.indexOf("="))
          )
        );
      }
      return;
    }

    let value = property.getValue();
    if (value === null) {
      if (!optionalValue) {
        let range = property.getNameRange();
        if (firstProperty) {
          problems.push(
            Validator.createENVRequiresTwoArguments(range.start, range.end)
          );
        } else {
          problems.push(
            Validator.createSyntaxMissingEquals(range.start, range.end, name)
          );
        }
      }
    } else if (value.charAt(0) === '"') {
      let found = false;
      for (let i = 1; i < value.length; i++) {
        switch (value.charAt(i)) {
          case escapeChar:
            i++;
            break;
          case '"':
            if (i === value.length - 1) {
              found = true;
            }
            break;
        }
      }

      if (!found) {
        let range = property.getValueRange();
        problems.push(
          Validator.createSyntaxMissingDoubleQuote(
            range.start,
            range.end,
            property.getUnescapedValue()
          )
        );
      }
    } else if (
      value.charAt(0) === "'" &&
      value.charAt(value.length - 1) !== "'"
    ) {
      let range = property.getValueRange();
      problems.push(
        Validator.createSyntaxMissingSingleQuote(range.start, range.end, value)
      );
    }
  }

  validate(
    document: TextDocument,
    sendDiagnostics?: Function,
    sendProgress?: Function,
    sendPerformanceStats?: Function,
    sendFilesystemData?: Function,
    sendCodeLenses?: Function
  ): Diagnostic[] {
    this.document = document;
    let problems: Diagnostic[] = [];
    let dockerfile = DockerfileParser.parse(document.getText());
    this.checkDirectives(dockerfile, problems);
    let instructions = dockerfile.getInstructions();
    if (
      instructions.length === 0 ||
      dockerfile.getARGs().length === instructions.length
    ) {
      // no instructions in this file, or only ARGs
      problems.push(
        Validator.createNoSourceImage(
          document.positionAt(0),
          document.positionAt(0)
        )
      );
    }

    let cmds: Cmd[] = [];
    let entrypoints: Entrypoint[] = [];
    let healthchecks: Healthcheck[] = [];
    let duplicates: (Cmd | Entrypoint | Healthcheck)[] = [];
    for (let instruction of instructions) {
      if (instruction instanceof Cmd) {
        cmds.push(instruction);
      } else if (instruction instanceof Entrypoint) {
        entrypoints.push(instruction);
      } else if (instruction instanceof Healthcheck) {
        healthchecks.push(instruction);
      } else if (instruction instanceof From) {
        if (cmds.length > 1) {
          duplicates = duplicates.concat(cmds);
        }
        if (entrypoints.length > 1) {
          duplicates = duplicates.concat(entrypoints);
        }
        if (healthchecks.length > 1) {
          duplicates = duplicates.concat(healthchecks);
        }
        cmds = [];
        entrypoints = [];
        healthchecks = [];
      }
    }
    if (cmds.length > 1) {
      duplicates = duplicates.concat(cmds);
    }
    if (entrypoints.length > 1) {
      duplicates = duplicates.concat(entrypoints);
    }
    if (healthchecks.length > 1) {
      duplicates = duplicates.concat(healthchecks);
    }
    for (let duplicate of duplicates) {
      if (duplicate instanceof Cmd) {
        // more than one CMD found, warn the user
        let diagnostic = this.createMultipleInstructions(
          duplicate.getInstructionRange(),
          this.settings.instructionCmdMultiple,
          "CMD"
        );
        if (diagnostic) {
          problems.push(diagnostic);
        }
      } else if (duplicate instanceof Entrypoint) {
        // more than one ENTRYPOINT found, warn the user
        let diagnostic = this.createMultipleInstructions(
          duplicate.getInstructionRange(),
          this.settings.instructionEntrypointMultiple,
          "ENTRYPOINT"
        );
        if (diagnostic) {
          problems.push(diagnostic);
        }
      } else {
        // more than one HEALTHCHECK found, warn the user
        let diagnostic = this.createMultipleInstructions(
          duplicate.getInstructionRange(),
          this.settings.instructionHealthcheckMultiple,
          "HEALTHCHECK"
        );
        if (diagnostic) {
          problems.push(diagnostic);
        }
      }
    }

    const names: any = {};
    const froms = dockerfile.getFROMs();
    for (let from of froms) {
      let name = from.getBuildStage();
      if (name) {
        name = name.toLowerCase();
        if (!names[name]) {
          names[name] = [];
        }
        names[name].push(from.getBuildStageRange());
      }
    }

    for (let name in names) {
      // duplicates found
      if (names[name].length > 1) {
        for (let range of names[name]) {
          problems.push(Validator.createDuplicateBuildStageName(range, name));
        }
      }
    }

    let escapeChar = dockerfile.getEscapeCharacter();
    let hasFrom = false;
    for (let instruction of dockerfile.getInstructions()) {
      let keyword = instruction.getKeyword();
      if (keyword === "FROM") {
        hasFrom = true;
      } else if (!hasFrom && keyword !== "ARG") {
        // first non-ARG instruction is not a FROM
        let range = instruction.getInstructionRange();
        problems.push(Validator.createNoSourceImage(range.start, range.end));
        hasFrom = true;
      }
      try {
        this.validateInstruction(
          document,
          escapeChar,
          instruction,
          keyword,
          false,
          problems
        );
        this.checkVariables(instruction, problems);
      } catch (e) {
        //console.log(e);
      }
    }

    for (let instruction of dockerfile.getOnbuildTriggers()) {
      try {
        this.validateInstruction(
          document,
          escapeChar,
          instruction,
          instruction.getKeyword(),
          true,
          problems
        );
      } catch (e) {
        //console.log(e);
      }
    }

    //Checking for problems that can be repaired
    const repairableProblems = checkRepairableProblems(dockerfile);
    if (repairableProblems.length > 0) problems.push(...repairableProblems);

    let foundError = false;

    for (let problem of problems) {
      if (problem.severity == DiagnosticSeverity.Error) {
        foundError = true;
        break;
      }
    }

    if (foundError) {
      if (this.dynamicAnalysis) {
        this.dynamicAnalysis.destroy();
      }
    } else if (this.dynAnalEnabled) {
      if (
        this.dynamicAnalysis &&
        this.dynamicAnalysis.document.version > document.version
      ) {
        return;
      } else {
        if (this.dynamicAnalysis) {
          this.dynamicAnalysis.destroy();
        }
        this.dynamicAnalysis = new DynamicAnalysis(
          document,
          sendDiagnostics,
          sendProgress,
          sendPerformanceStats,
          sendFilesystemData,
          sendCodeLenses,
          problems,
          dockerfile,
          this.docker
        );
      }
    }

    return problems;
  }

  restartAnalysis() {
    if (this.dynamicAnalysis) {
      this.dynamicAnalysis = this.dynamicAnalysis.restart();
    }
  }

  stopAnalysis() {
    this.dynamicAnalysis.destroy();
  }

  get currentContainerName(): string {
    if (this.dynamicAnalysis) {
      return this.dynamicAnalysis.containerName;
    }
  }

  private validateInstruction(
    document: TextDocument,
    escapeChar: string,
    instruction: Instruction,
    keyword: string,
    isTrigger: boolean,
    problems: Diagnostic[]
  ): void {
    if (KEYWORDS.indexOf(keyword) === -1) {
      let range = instruction.getInstructionRange();
      // invalid instruction found
      problems.push(
        Validator.createUnknownInstruction(range.start, range.end, keyword)
      );
    } else {
      if (keyword !== instruction.getInstruction()) {
        let range = instruction.getInstructionRange();
        // warn about uppercase convention if the keyword doesn't match the actual instruction
        let diagnostic = this.createUppercaseInstruction(
          range.start,
          range.end
        );
        if (diagnostic) {
          problems.push(diagnostic);
        }
      }

      if (keyword === "MAINTAINER") {
        let range = instruction.getInstructionRange();
        let diagnostic = this.createMaintainerDeprecated(
          range.start,
          range.end
        );
        if (diagnostic) {
          problems.push(diagnostic);
        }
      }

      const fullRange = instruction.getRange();
      if (fullRange.start.line !== fullRange.end.line && !isTrigger) {
        // if the instruction spans multiple lines, check for empty newlines
        const content = document.getText();
        const endingLine = fullRange.end.line;
        let start = -1;
        for (let i = fullRange.start.line; i <= endingLine; i++) {
          const lineContent = content.substring(
            document.offsetAt(Position.create(i, 0)),
            document.offsetAt(Position.create(i + 1, 0))
          );
          if (lineContent.trim().length === 0) {
            if (start === -1) {
              start = i;
              continue;
            }
          } else if (start !== -1) {
            const diagnostic = Validator.createEmptyContinuationLine(
              Position.create(start, 0),
              Position.create(i, 0),
              this.settings.emptyContinuationLine
            );
            if (diagnostic) {
              problems.push(diagnostic);
            }
            start = -1;
          }
        }

        if (start !== -1) {
          const diagnostic = Validator.createEmptyContinuationLine(
            Position.create(start, 0),
            Position.create(endingLine + 1, 0),
            this.settings.emptyContinuationLine
          );
          if (diagnostic) {
            problems.push(diagnostic);
          }
          start = -1;
        }
      }

      switch (keyword) {
        case "CMD":
          this.checkJSONQuotes(instruction, problems);
          break;
        case "ENTRYPOINT":
        case "RUN":
        case "VOLUME":
          this.checkArguments(instruction, problems, [-1], function (): any {
            return null;
          });
          this.checkJSONQuotes(instruction, problems);
          break;
        case "ARG":
          this.checkArguments(
            instruction,
            problems,
            [-1],
            function (index: number) {
              if (index > 0) {
                return Validator.createARGRequiresOneArgument;
              }
              return null;
            },
            Validator.createARGRequiresOneArgument
          );
          let arg = instruction as Arg;
          let argProperty = arg.getProperty();
          if (argProperty) {
            this.checkProperty(
              document,
              escapeChar,
              keyword,
              argProperty,
              true,
              true,
              problems
            );
          }
          break;
        case "ENV":
        case "LABEL":
          this.checkArguments(instruction, problems, [-1], function (): any {
            return null;
          });
          let properties = (instruction as PropertyInstruction).getProperties();
          if (properties.length === 1) {
            this.checkProperty(
              document,
              escapeChar,
              keyword,
              properties[0],
              true,
              false,
              problems
            );
          } else if (properties.length !== 0) {
            for (let property of properties) {
              this.checkProperty(
                document,
                escapeChar,
                keyword,
                property,
                false,
                false,
                problems
              );
            }
          }
          break;
        case "FROM":
          const fromFlags = (instruction as ModifiableInstruction).getFlags();
          for (const flag of fromFlags) {
            const flagName = flag.getName();
            if (flagName !== "platform") {
              const range = flag.getRange();
              problems.push(
                Validator.createUnknownFromFlag(
                  range.start,
                  flagName === "" ? range.end : flag.getNameRange().end,
                  flag.getName()
                )
              );
            }
          }
          this.checkFlagValue(fromFlags, ["platform"], problems);
          this.checkArguments(
            instruction,
            problems,
            [1, 3],
            function (
              index: number,
              argument: string,
              range: Range
            ): Diagnostic | Function | null {
              switch (index) {
                case 0:
                  let variables = instruction.getVariables();
                  if (variables.length > 0) {
                    let variableRange = variables[0].getRange();
                    if (
                      variableRange.start.line === range.start.line &&
                      variableRange.start.character === range.start.character &&
                      variableRange.end.line === range.end.line &&
                      variableRange.end.character === range.end.character
                    ) {
                      if (!variables[0].isDefined()) {
                        return Validator.createBaseNameEmpty(
                          variableRange,
                          variables[0].toString()
                        );
                      }
                    }
                    return null;
                  }
                  let from = instruction as From;
                  let digestRange = from.getImageDigestRange();
                  if (digestRange === null) {
                    let tagRange = from.getImageTagRange();
                    if (tagRange === null) {
                      return null;
                    }
                    let tag = document.getText(tagRange);
                    if (tag === "") {
                      // no tag specified, just highlight the whole argument
                      return Validator.createInvalidReferenceFormat(range);
                    }
                    let tagRegexp = new RegExp(/^[\w][\w.-]{0,127}$/);
                    if (tagRegexp.test(tag)) {
                      return null;
                    }
                    return Validator.createInvalidReferenceFormat(
                      from.getImageTagRange()
                    );
                  }
                  let digest = document.getText(digestRange);
                  let algorithmIndex = digest.indexOf(":");
                  if (algorithmIndex === -1) {
                    if (digest === "") {
                      // no digest specified, just highlight the whole argument
                      return Validator.createInvalidReferenceFormat(range);
                    }
                    return Validator.createInvalidReferenceFormat(
                      from.getImageDigestRange()
                    );
                  }
                  let algorithmRegexp = new RegExp(/[A-Fa-f0-9_+.-]+/);
                  let algorithm = digest.substring(0, algorithmIndex);
                  if (!algorithmRegexp.test(algorithm)) {
                    return Validator.createInvalidReferenceFormat(
                      from.getImageDigestRange()
                    );
                  }
                  let hex = digest.substring(algorithmIndex + 1);
                  let hexRegexp = new RegExp(/[A-Fa-f0-9]+/);
                  if (hexRegexp.test(hex)) {
                    return null;
                  }
                  return Validator.createInvalidReferenceFormat(
                    from.getImageDigestRange()
                  );
                case 1:
                  return argument.toUpperCase() === "AS"
                    ? null
                    : Validator.createInvalidAs;
                case 2:
                  argument = argument.toLowerCase();
                  let regexp = new RegExp(/^[a-z]([a-z0-9_\-.]*)*$/);
                  if (regexp.test(argument)) {
                    return null;
                  }
                  return Validator.createInvalidBuildStageName(range, argument);
                default:
                  return null;
              }
            },
            Validator.createRequiresOneOrThreeArguments
          );
          break;
        case "HEALTHCHECK":
          let args = instruction.getArguments();
          const healthcheckFlags = (
            instruction as ModifiableInstruction
          ).getFlags();
          if (args.length === 0) {
            // all instructions are expected to have at least one argument
            problems.push(
              Validator.createHEALTHCHECKRequiresAtLeastOneArgument(
                instruction.getInstructionRange()
              )
            );
          } else {
            const value = args[0].getValue();
            const uppercase = value.toUpperCase();
            if (uppercase === "NONE") {
              // check that NONE doesn't have any arguments after it
              if (args.length > 1) {
                // get the next argument
                const start = args[1].getRange().start;
                // get the last argument
                const end = args[args.length - 1].getRange().end;
                // highlight everything after the NONE and warn the user
                problems.push(
                  Validator.createHealthcheckNoneUnnecessaryArgument(start, end)
                );
              }
              // don't need to validate flags of a NONE
              break;
            } else if (uppercase === "CMD") {
              if (args.length === 1) {
                // this HEALTHCHECK has a CMD with no arguments
                const range = args[0].getRange();
                problems.push(
                  Validator.createHealthcheckCmdArgumentMissing(
                    range.start,
                    range.end
                  )
                );
              }
            } else {
              // unknown HEALTHCHECK type
              problems.push(
                Validator.createHealthcheckTypeUnknown(
                  args[0].getRange(),
                  uppercase
                )
              );
            }
          }

          const validFlags = ["interval", "retries", "start-period", "timeout"];
          for (const flag of healthcheckFlags) {
            const flagName = flag.getName();
            if (validFlags.indexOf(flagName) === -1) {
              const range = flag.getRange();
              problems.push(
                Validator.createUnknownHealthcheckFlag(
                  range.start,
                  flagName === "" ? range.end : flag.getNameRange().end,
                  flag.getName()
                )
              );
            } else if (flagName === "retries") {
              const value = flag.getValue();
              if (value) {
                const valueRange = flag.getValueRange();
                const integer = parseInt(value);
                // test for NaN or numbers with decimals
                if (isNaN(integer) || value.indexOf(".") !== -1) {
                  problems.push(
                    Validator.createInvalidSyntax(
                      valueRange.start,
                      valueRange.end,
                      value
                    )
                  );
                } else if (integer < 1) {
                  problems.push(
                    Validator.createFlagAtLeastOne(
                      valueRange.start,
                      valueRange.end,
                      "--retries",
                      integer.toString()
                    )
                  );
                }
              }
            }
          }

          this.checkFlagValue(healthcheckFlags, validFlags, problems);
          this.checkFlagDuration(
            healthcheckFlags,
            ["interval", "start-period", "timeout"],
            problems
          );
          this.checkDuplicateFlags(healthcheckFlags, validFlags, problems);
          break;
        case "ONBUILD":
          this.checkArguments(instruction, problems, [-1], function (): any {
            return null;
          });
          let onbuild = instruction as Onbuild;
          let trigger = onbuild.getTrigger();
          switch (trigger) {
            case "FROM":
            case "MAINTAINER":
              problems.push(
                Validator.createOnbuildTriggerDisallowed(
                  onbuild.getTriggerRange(),
                  trigger
                )
              );
              break;
            case "ONBUILD":
              problems.push(
                Validator.createOnbuildChainingDisallowed(
                  onbuild.getTriggerRange()
                )
              );
              break;
          }
          break;
        case "SHELL":
          this.checkArguments(instruction, problems, [-1], function (): any {
            return null;
          });
          this.checkJSON(document, instruction as JSONInstruction, problems);
          break;
        case "STOPSIGNAL":
          this.checkArguments(
            instruction,
            problems,
            [1],
            function (_index: number, argument: string) {
              if (
                argument.indexOf("SIG") === 0 ||
                argument.indexOf("$") != -1
              ) {
                return null;
              }

              for (var i = 0; i < argument.length; i++) {
                if ("0" > argument.charAt(i) || "9" < argument.charAt(i)) {
                  return Validator.createInvalidStopSignal;
                }
              }
              return null;
            }
          );
          let stopsignalArgs = instruction.getExpandedArguments();
          if (stopsignalArgs.length === 1) {
            let value = stopsignalArgs[0].getValue();
            let variables = instruction.getVariables();
            if (variables.length === 0) {
              if (value.indexOf("$") !== -1) {
                let range = stopsignalArgs[0].getRange();
                problems.push(
                  Validator.createInvalidStopSignal(
                    range.start,
                    range.end,
                    value
                  )
                );
              }
            } else {
              for (let variable of variables) {
                let variableRange = variable.getRange();
                let variableDefinition = this.document
                  .getText()
                  .substring(
                    this.document.offsetAt(variableRange.start),
                    this.document.offsetAt(variableRange.end)
                  );
                // an un-expanded variable is here
                if (
                  value.includes(variableDefinition) &&
                  !variable.isBuildVariable() &&
                  !variable.isDefined()
                ) {
                  let range = stopsignalArgs[0].getRange();
                  problems.push(
                    Validator.createInvalidStopSignal(
                      range.start,
                      range.end,
                      ""
                    )
                  );
                  break;
                }
              }
            }
          }
          break;
        case "EXPOSE":
          let exposeArgs = instruction.getArguments();
          let exposeExpandedArgs = instruction.getExpandedArguments();
          if (exposeExpandedArgs.length === 0) {
            let range = instruction.getInstructionRange();
            problems.push(
              Validator.createMissingArgument(range.start, range.end)
            );
          } else {
            const regex =
              /^([0-9])+(-[0-9]+)?(:([0-9])+(-[0-9]*)?)?(\/(\w*))?(\/\w*)*$/;
            argCheck: for (let i = 0; i < exposeExpandedArgs.length; i++) {
              let value = exposeExpandedArgs[i].getValue();
              if (
                value.charAt(0) === '"' &&
                value.charAt(value.length - 1) === '"'
              ) {
                value = value.substring(1, value.length - 1);
              }
              const match = regex.exec(value);
              if (match) {
                if (match[7]) {
                  const protocol = match[7].toLowerCase();
                  if (
                    protocol !== "" &&
                    protocol !== "tcp" &&
                    protocol !== "udp" &&
                    protocol !== "sctp"
                  ) {
                    const range = exposeExpandedArgs[i].getRange();
                    const rangeStart = this.document.offsetAt(range.start);
                    const rawArg = this.document
                      .getText()
                      .substring(rangeStart, this.document.offsetAt(range.end));
                    const start =
                      rangeStart + rawArg.indexOf(match[7].substring(0, 1));
                    const end =
                      protocol.length === 1
                        ? rangeStart + start + 1
                        : rangeStart + rawArg.length;
                    problems.push(
                      Validator.createInvalidProto(
                        this.document.positionAt(start),
                        this.document.positionAt(end),
                        match[7]
                      )
                    );
                  }
                }
              } else {
                // see if we're referencing a variable here
                if (value.charAt(0) === "$") {
                  continue argCheck;
                }
                problems.push(
                  Validator.createInvalidPort(
                    exposeExpandedArgs[i].getRange(),
                    value
                  )
                );
              }
            }
          }
          break;
        case "ADD":
          const add = instruction as Add;
          const addFlags = add.getFlags();
          for (let flag of addFlags) {
            const name = flag.getName();
            const flagRange = flag.getRange();
            if (name === "") {
              problems.push(
                Validator.createUnknownAddFlag(
                  flagRange.start,
                  flagRange.end,
                  name
                )
              );
            } else if (name !== "chown") {
              let range = flag.getNameRange();
              problems.push(
                Validator.createUnknownAddFlag(flagRange.start, range.end, name)
              );
            }
          }
          const addDestinationDiagnostic = this.checkDestinationIsDirectory(
            add,
            Validator.createADDRequiresAtLeastTwoArguments,
            Validator.createADDDestinationNotDirectory
          );
          if (addDestinationDiagnostic !== null) {
            problems.push(addDestinationDiagnostic);
          }
          this.checkFlagValue(addFlags, ["chown"], problems);
          this.checkDuplicateFlags(addFlags, ["chown"], problems);
          this.checkJSONQuotes(instruction, problems);
          break;
        case "COPY":
          let copy = instruction as Copy;
          let flags = copy.getFlags();
          if (flags.length > 0) {
            for (let flag of flags) {
              const name = flag.getName();
              const flagRange = flag.getRange();
              if (name === "") {
                problems.push(
                  Validator.createUnknownCopyFlag(
                    flagRange.start,
                    flagRange.end,
                    name
                  )
                );
              } else if (name !== "from" && name !== "chown") {
                let range = flag.getNameRange();
                problems.push(
                  Validator.createUnknownCopyFlag(
                    flagRange.start,
                    range.end,
                    name
                  )
                );
              }
            }

            let flag = copy.getFromFlag();
            if (flag) {
              let value = flag.getValue();
              if (value !== null) {
                let regexp = new RegExp(/^[a-zA-Z0-9].*$/);
                if (!regexp.test(value)) {
                  let range =
                    value === "" ? flag.getRange() : flag.getValueRange();
                  problems.push(
                    Validator.createFlagInvalidFrom(
                      range.start,
                      range.end,
                      value
                    )
                  );
                }
              }
            }
          }
          const copyDestinationDiagnostic = this.checkDestinationIsDirectory(
            copy,
            Validator.createCOPYRequiresAtLeastTwoArguments,
            Validator.createCOPYDestinationNotDirectory
          );
          if (copyDestinationDiagnostic !== null) {
            problems.push(copyDestinationDiagnostic);
          }
          this.checkFlagValue(flags, ["chown", "from"], problems);
          this.checkDuplicateFlags(flags, ["chown", "from"], problems);
          this.checkJSONQuotes(instruction, problems);
          break;
        case "WORKDIR":
          this.checkArguments(instruction, problems, [-1], function (): any {
            return null;
          });

          let content = instruction.getArgumentsContent();
          if (content) {
            // strip out any surrounding quotes
            const first = content.substring(0, 1);
            const last = content.substring(content.length - 1);
            if (
              (first === "'" && last === "'") ||
              (first === '"' && last === '"')
            ) {
              content = content.substring(1, content.length - 1);
            }
            let regexp = new RegExp(/^(\$|([a-zA-Z](\$|:(\$|\\|\/)))).*$/);
            if (!content.startsWith("/") && !regexp.test(content)) {
              let problem = this.createWORKDIRNotAbsolute(
                instruction.getArgumentsRange()
              );
              if (problem) {
                problems.push(problem);
              }
            }
          }
          break;
        default:
          this.checkArguments(instruction, problems, [-1], function (): any {
            return null;
          });
          break;
      }
    }
  }

  private checkDestinationIsDirectory(
    instruction: JSONInstruction,
    requiresTwoArgumentsFunction: Function,
    notDirectoryFunction: Function
  ): Diagnostic | null {
    if (instruction.getClosingBracket()) {
      return this.checkJsonDestinationIsDirectory(
        instruction,
        requiresTwoArgumentsFunction,
        notDirectoryFunction
      );
    }

    const args = instruction.getArguments();
    if (args.length === 1) {
      return requiresTwoArgumentsFunction(args[0].getRange());
    } else if (args.length === 0) {
      return requiresTwoArgumentsFunction(instruction.getInstructionRange());
    } else if (args.length > 2) {
      const lastArg = args[args.length - 1];
      const variables = instruction.getVariables();
      if (variables.length !== 0) {
        const lastJsonStringOffset = this.document.offsetAt(
          lastArg.getRange().end
        );
        const lastVarOffset = this.document.offsetAt(
          variables[variables.length - 1].getRange().end
        );
        if (
          lastJsonStringOffset === lastVarOffset ||
          lastJsonStringOffset - 1 === lastVarOffset
        ) {
          return null;
        }
      }
      const destination = lastArg.getValue();
      const lastChar = destination.charAt(destination.length - 1);
      if (lastChar !== "\\" && lastChar !== "/") {
        return notDirectoryFunction(lastArg.getRange());
      }
    }
    return null;
  }

  private checkJsonDestinationIsDirectory(
    instruction: JSONInstruction,
    requiresTwoArgumentsFunction: Function,
    notDirectoryFunction: Function
  ): Diagnostic | null {
    const jsonStrings = instruction.getJSONStrings();
    if (jsonStrings.length === 0) {
      return requiresTwoArgumentsFunction(instruction.getArgumentsRange());
    } else if (jsonStrings.length === 1) {
      return requiresTwoArgumentsFunction(jsonStrings[0].getJSONRange());
    } else if (jsonStrings.length > 2) {
      const lastJsonString = jsonStrings[jsonStrings.length - 1];
      const variables = instruction.getVariables();
      if (variables.length !== 0) {
        const lastVar = variables[variables.length - 1];
        const lastJsonStringOffset = this.document.offsetAt(
          lastJsonString.getRange().end
        );
        const lastVarOffset = this.document.offsetAt(lastVar.getRange().end);
        if (
          lastJsonStringOffset === lastVarOffset ||
          lastJsonStringOffset - 1 === lastVarOffset
        ) {
          return null;
        }
      }
      const destination = lastJsonString.getValue();
      const lastChar = destination.charAt(destination.length - 2);
      if (lastChar !== "\\" && lastChar !== "/") {
        return notDirectoryFunction(
          jsonStrings[jsonStrings.length - 1].getJSONRange()
        );
      }
    }
    return null;
  }

  private checkFlagValue(
    flags: Flag[],
    validFlagNames: string[],
    problems: Diagnostic[]
  ): void {
    for (let flag of flags) {
      let flagName = flag.getName();
      // only validate flags with the right name
      if (flag.getValue() === null && validFlagNames.indexOf(flagName) !== -1) {
        let range = flag.getNameRange();
        problems.push(
          Validator.createFlagMissingValue(range.start, range.end, flagName)
        );
      }
    }
  }

  private checkFlagDuration(
    flags: Flag[],
    validFlagNames: string[],
    problems: Diagnostic[]
  ): void {
    flagCheck: for (let flag of flags) {
      let flagName = flag.getName();
      // only validate flags with the right name
      if (validFlagNames.indexOf(flagName) !== -1) {
        let value = flag.getValue();
        if (value !== null && value.length !== 0) {
          switch (value.charAt(0)) {
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            case "8":
            case "9":
            case ".":
            case "-":
              break;
            default:
              let range = flag.getValueRange();
              problems.push(
                Validator.createFlagInvalidDuration(
                  range.start,
                  range.end,
                  value
                )
              );
              continue flagCheck;
          }

          let durationSpecified = false;
          let start = 0;
          let duration = 0;
          let digitFound = false;
          let hyphenFound = false;
          let periodsDetected = 0;
          durationParse: for (let i = 0; i < value.length; i++) {
            durationSpecified = false;
            switch (value.charAt(i)) {
              case "-":
                if (digitFound) {
                  let range = flag.getValueRange();
                  problems.push(
                    Validator.createFlagUnknownUnit(
                      range,
                      value.charAt(i),
                      value
                    )
                  );
                  continue flagCheck;
                } else if (hyphenFound) {
                  let range = flag.getValueRange();
                  problems.push(
                    Validator.createFlagInvalidDuration(
                      range.start,
                      range.end,
                      value
                    )
                  );
                  continue flagCheck;
                }
                hyphenFound = true;
                continue;
              case ".":
                periodsDetected++;
                continue;
              case "0":
              case "1":
              case "2":
              case "3":
              case "4":
              case "5":
              case "6":
              case "7":
              case "8":
              case "9":
                digitFound = true;
                continue;
              default:
                if (periodsDetected > 1) {
                  let range = flag.getValueRange();
                  problems.push(
                    Validator.createFlagMissingDuration(
                      range.start,
                      range.end,
                      value
                    )
                  );
                  continue flagCheck;
                }
                periodsDetected = 0;
                let time = parseFloat(value.substring(start, i));
                for (let j = i + 1; j < value.length; j++) {
                  if (Validator.isNumberRelated(value.charAt(j))) {
                    let unit = value.substring(i, j);
                    if (
                      time < 0 ||
                      (value.charAt(start) === "-" && time === 0)
                    ) {
                      let nameRange = flag.getNameRange();
                      problems.push(
                        Validator.createFlagLessThan1ms(
                          nameRange.start,
                          nameRange.end,
                          flagName
                        )
                      );
                      continue flagCheck;
                    }
                    switch (unit) {
                      case "h":
                        // hours
                        duration += time * 1000 * 60 * 60;
                        i = j - 1;
                        start = i;
                        durationSpecified = true;
                        continue durationParse;
                      case "m":
                        // minutes
                        duration += time * 1000 * 60;
                        i = j - 1;
                        start = i;
                        durationSpecified = true;
                        continue durationParse;
                      case "s":
                        // seconds
                        duration += time * 1000;
                        i = j - 1;
                        start = i;
                        durationSpecified = true;
                        continue durationParse;
                      case "ms":
                        // milliseconds
                        duration += time;
                        i = j - 1;
                        start = i;
                        durationSpecified = true;
                        continue durationParse;
                      case "us":
                      case "µs":
                        // microseconds
                        duration += time / 1000;
                        i = j - 1;
                        start = i;
                        durationSpecified = true;
                        continue durationParse;
                      case "ns":
                        // nanoseconds
                        duration += time / 1000000;
                        i = j - 1;
                        start = i;
                        durationSpecified = true;
                        continue durationParse;
                      default:
                        let range = flag.getValueRange();
                        problems.push(
                          Validator.createFlagUnknownUnit(range, unit, value)
                        );
                        continue flagCheck;
                    }
                  }
                }
                if (time < 0 || (value.charAt(start) === "-" && time === 0)) {
                  let nameRange = flag.getNameRange();
                  problems.push(
                    Validator.createFlagLessThan1ms(
                      nameRange.start,
                      nameRange.end,
                      flagName
                    )
                  );
                  continue flagCheck;
                }
                let unit = value.substring(i, value.length);
                switch (unit) {
                  case "h":
                    // hours
                    duration += time * 1000 * 60 * 60;
                    durationSpecified = true;
                    break durationParse;
                  case "m":
                    // minutes
                    duration += time * 1000 * 60;
                    durationSpecified = true;
                    break durationParse;
                  case "s":
                    // seconds
                    duration += time * 1000;
                    durationSpecified = true;
                    break durationParse;
                  case "ms":
                    // minutes
                    duration += time;
                    durationSpecified = true;
                    break durationParse;
                  case "us":
                  case "µs":
                    // microseconds
                    duration += time / 1000;
                    durationSpecified = true;
                    break durationParse;
                  case "ns":
                    // nanoseconds
                    duration += time / 1000000;
                    durationSpecified = true;
                    break durationParse;
                  default:
                    let range = flag.getValueRange();
                    problems.push(
                      Validator.createFlagUnknownUnit(range, unit, value)
                    );
                    break;
                }
                continue flagCheck;
            }
          }

          if (!durationSpecified) {
            let range = flag.getValueRange();
            problems.push(
              Validator.createFlagMissingDuration(range.start, range.end, value)
            );
          } else if (duration < 1) {
            let range = flag.getNameRange();
            problems.push(
              Validator.createFlagLessThan1ms(range.start, range.end, flagName)
            );
          }
        }
      }
    }
  }

  private static isNumberRelated(character: string) {
    switch (character) {
      case ".":
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        return true;
    }
    return false;
  }

  private checkDuplicateFlags(
    flags: Flag[],
    validFlags: string[],
    problems: Diagnostic[]
  ): void {
    let flagNames = flags.map(function (flag) {
      return flag.getName();
    });
    for (let validFlag of validFlags) {
      let index = flagNames.indexOf(validFlag);
      let lastIndex = flagNames.lastIndexOf(validFlag);
      if (index !== lastIndex) {
        let range = flags[index].getNameRange();
        problems.push(
          Validator.createFlagDuplicate(
            range.start,
            range.end,
            flagNames[index]
          )
        );
        range = flags[lastIndex].getNameRange();
        problems.push(
          Validator.createFlagDuplicate(
            range.start,
            range.end,
            flagNames[index]
          )
        );
      }
    }
  }

  private checkJSON(
    document: TextDocument,
    instruction: JSONInstruction,
    problems: Diagnostic[]
  ) {
    let argsContent = instruction.getArgumentsContent();
    if (argsContent === null) {
      return;
    }

    let argsRange = instruction.getArgumentsRange();
    let args = instruction.getArguments();
    if (
      (args.length === 1 && args[0].getValue() === "[]") ||
      (args.length === 2 &&
        args[0].getValue() === "[" &&
        args[1].getValue() === "]")
    ) {
      problems.push(Validator.createShellRequiresOne(argsRange));
      return;
    }

    const closing = instruction.getClosingBracket();
    if (closing) {
      let content = document.getText();
      content = content.substring(
        document.offsetAt(instruction.getOpeningBracket().getRange().end),
        document.offsetAt(closing.getRange().start)
      );
      content = content.trim();
      if (content.charAt(content.length - 1) !== '"') {
        problems.push(Validator.createShellJsonForm(argsRange));
      }
    } else {
      problems.push(Validator.createShellJsonForm(argsRange));
    }
  }

  private checkJSONQuotes(instruction: Instruction, problems: Diagnostic[]) {
    let argsContent = instruction.getArgumentsContent();
    if (argsContent === null) {
      return;
    }

    let argsRange = instruction.getArgumentsRange();
    let args = instruction.getArguments();
    if (
      (args.length === 1 && args[0].getValue() === "[]") ||
      (args.length === 2 &&
        args[0].getValue() === "[" &&
        args[1].getValue() === "]")
    ) {
      return;
    }

    let jsonLike = false;
    let last: string = null;
    let quoted = false;
    argsCheck: for (let i = 0; i < argsContent.length; i++) {
      switch (argsContent.charAt(i)) {
        case "[":
          if (last === null) {
            last = "[";
            jsonLike = true;
          }
          break;
        case "'":
          if (last === "[" || last === ",") {
            quoted = true;
            last = "'";
            continue;
          } else if (last === "'") {
            if (quoted) {
              // quoted string done
              quoted = false;
            } else {
              // should be a , or a ]
              break argsCheck;
            }
          } else {
            break argsCheck;
          }
          break;
        case ",":
          if (!jsonLike) {
            break argsCheck;
          } else if (!quoted) {
            if (last === "'") {
              last = ",";
            } else {
              break argsCheck;
            }
          }
          break;
        case "]":
          if (!quoted) {
            if (last === "'" || last === ",") {
              last = null;
              const problem = Validator.createJSONInSingleQuotes(
                argsRange,
                this.settings.instructionJSONInSingleQuotes
              );
              if (problem) {
                problems.push(problem);
              }
            }
            break argsCheck;
          }
          break;
        case " ":
        case "\t":
          break;
        default:
          if (!quoted) {
            break argsCheck;
          }
          break;
      }
    }
  }

  private static dockerProblems = {
    baseNameEmpty: "base name (${0}) should not be blank",

    directiveCasing: "Parser directives should be written in lowercase letters",
    directiveEscapeDuplicated: "only one escape parser directive can be used",
    directiveEscapeInvalid: "invalid ESCAPE '${0}'. Must be ` or \\",

    noSourceImage: "No source image provided with `FROM`",

    emptyContinuationLine: "Empty continuation line",

    fromRequiresOneOrThreeArguments:
      "FROM requires either one or three arguments",

    invalidAs: "Second argument should be AS",
    invalidPort: "Invalid containerPort: ${0}",
    invalidProtocol: "Invalid proto: ${0}",
    invalidReferenceFormat: "invalid reference format",
    invalidStopSignal: "Invalid signal: ${0}",
    invalidSyntax: 'parsing "${0}": invalid syntax',
    invalidDestination:
      "When using ${0} with more than one source file, the destination must be a directory and end with a / or a \\",

    syntaxMissingEquals:
      'Syntax error - can\'t find = in "${0}". Must be of the form: name=value',
    syntaxMissingNames: "${0} names can not be blank",
    syntaxMissingSingleQuote:
      'failed to process "${0}": unexpected end of statement while looking for matching single-quote',
    syntaxMissingDoubleQuote:
      'failed to process "${0}": unexpected end of statement while looking for matching double-quote',

    duplicateBuildStageName: "duplicate name ${0}",
    invalidBuildStageName:
      'invalid name for build stage: "${0}", name can\'t start with a number or contain symbols',

    flagAtLeastOne: "${0} must be at least 1 (not ${1})",
    flagDuplicate: "Duplicate flag specified: ${0}",
    flagInvalidDuration: "time: invalid duration ${0}",
    flagInvalidFrom: "invalid from flag value ${0}: invalid reference format",
    flagLessThan1ms: 'Interval "${0}" cannot be less than 1ms',
    flagMissingDuration: "time: missing unit in duration ${0}",
    flagMissingValue: "Missing a value on flag: ${0}",
    flagUnknown: "Unknown flag: ${0}",
    flagUnknownUnit: "time: unknown unit ${0} in duration ${1}",

    instructionExtraArgument: "Instruction has an extra argument",
    instructionMissingArgument: "Instruction has no arguments",
    instructionMultiple:
      "There can only be one ${0} instruction in a Dockerfile",
    instructionRequiresOneArgument: "${0} requires exactly one argument",
    instructionRequiresAtLeastOneArgument:
      "${0} requires at least one argument",
    instructionRequiresAtLeastTwoArguments:
      "${0} requires at least two arguments",
    instructionRequiresTwoArguments: "${0} must have two arguments",
    instructionUnnecessaryArgument: "${0} takes no arguments",
    instructionUnknown: "Unknown instruction: ${0}",
    instructionCasing: "Instructions should be written in uppercase letters",
    instructionJSONInSingleQuotes:
      "Instruction written as a JSON array but is using single quotes instead of double quotes",

    variableModifierUnsupported:
      'failed to process "${0}": unsupported modifier (${1}) in substitution',

    onbuildChainingDisallowed:
      "Chaining ONBUILD via `ONBUILD ONBUILD` isn't allowed",
    onbuildTriggerDisallowed: "${0} isn't allowed as an ONBUILD trigger",

    shellJsonForm: "SHELL requires the arguments to be in JSON form",
    shellRequiresOne: "SHELL requires at least one argument",

    deprecatedMaintainer: "MAINTAINER has been deprecated",

    healthcheckCmdArgumentMissing: "Missing command after HEALTHCHECK CMD",
    healthcheckTypeUnknown: 'Unknown type"${0}" in HEALTHCHECK (try CMD)',

    workdirPathNotAbsolute: "WORKDIR paths should be absolute",
  };

  private static formatMessage(text: string, ...variables: string[]): string {
    for (let i = 0; i < variables.length; i++) {
      text = text.replace("${" + i + "}", variables[i]);
    }
    return text;
  }

  public static getDiagnosticMessage_DirectiveCasing() {
    return Validator.dockerProblems["directiveCasing"];
  }

  public static getDiagnosticMessage_DirectiveEscapeDuplicated() {
    return Validator.dockerProblems["directiveEscapeDuplicated"];
  }

  public static getDiagnosticMessage_DirectiveEscapeInvalid(value: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["directiveEscapeInvalid"],
      value
    );
  }

  public static getDiagnosticMessage_NoSourceImage() {
    return Validator.dockerProblems["noSourceImage"];
  }

  public static getDiagnosticMessage_EmptyContinuationLine() {
    return Validator.dockerProblems["emptyContinuationLine"];
  }

  public static getDiagnosticMessage_DuplicateBuildStageName(name: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["duplicateBuildStageName"],
      name
    );
  }

  public static getDiagnosticMessage_InvalidBuildStageName(name: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["invalidBuildStageName"],
      name
    );
  }

  public static getDiagnosticMessage_FlagAtLeastOne(
    flagName: string,
    flagValue: string
  ) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagAtLeastOne"],
      flagName,
      flagValue
    );
  }

  public static getDiagnosticMessage_FlagDuplicate(flag: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagDuplicate"],
      flag
    );
  }

  public static getDiagnosticMessage_FlagInvalidDuration(flag: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagInvalidDuration"],
      flag
    );
  }

  public static getDiagnosticMessage_FlagLessThan1ms(flag: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagLessThan1ms"],
      flag
    );
  }

  public static getDiagnosticMessage_FlagMissingDuration(duration: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagMissingDuration"],
      duration
    );
  }

  public static getDiagnosticMessage_FlagInvalidFromValue(
    value: string
  ): string {
    return Validator.formatMessage(
      Validator.dockerProblems["flagInvalidFrom"],
      value
    );
  }

  public static getDiagnosticMessage_FlagMissingValue(flag: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagMissingValue"],
      flag
    );
  }

  public static getDiagnosticMessage_FlagUnknown(flag: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagUnknown"],
      flag
    );
  }

  public static getDiagnosticMessage_FlagUnknownUnit(
    unit: string,
    duration: string
  ) {
    return Validator.formatMessage(
      Validator.dockerProblems["flagUnknownUnit"],
      unit,
      duration
    );
  }

  public static getDiagnosticMessage_BaseNameEmpty(name: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["baseNameEmpty"],
      name
    );
  }

  public static getDiagnosticMessage_InvalidAs() {
    return Validator.dockerProblems["invalidAs"];
  }

  public static getDiagnosticMessage_InvalidPort(port: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["invalidPort"],
      port
    );
  }

  public static getDiagnosticMessage_InvalidProto(protocol: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["invalidProtocol"],
      protocol
    );
  }

  public static getDiagnosticMessage_InvalidReferenceFormat() {
    return Validator.dockerProblems["invalidReferenceFormat"];
  }

  public static getDiagnosticMessage_InvalidSignal(signal: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["invalidStopSignal"],
      signal
    );
  }

  public static getDiagnosticMessage_InvalidSyntax(syntax: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["invalidSyntax"],
      syntax
    );
  }

  public static getDiagnosticMessage_InstructionExtraArgument() {
    return Validator.dockerProblems["instructionExtraArgument"];
  }

  public static getDiagnosticMessage_InstructionMissingArgument() {
    return Validator.dockerProblems["instructionMissingArgument"];
  }

  public static getDiagnosticMessage_ADDDestinationNotDirectory() {
    return Validator.formatMessage(
      Validator.dockerProblems["invalidDestination"],
      "ADD"
    );
  }

  public static getDiagnosticMessage_ADDRequiresAtLeastTwoArguments() {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionRequiresAtLeastTwoArguments"],
      "ADD"
    );
  }

  public static getDiagnosticMessage_ARGRequiresOneArgument() {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionRequiresOneArgument"],
      "ARG"
    );
  }

  public static getDiagnosticMessage_COPYDestinationNotDirectory() {
    return Validator.formatMessage(
      Validator.dockerProblems["invalidDestination"],
      "COPY"
    );
  }

  public static getDiagnosticMessage_COPYRequiresAtLeastTwoArguments() {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionRequiresAtLeastTwoArguments"],
      "COPY"
    );
  }

  public static getDiagnosticMessage_HEALTHCHECKRequiresAtLeastOneArgument() {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionRequiresAtLeastOneArgument"],
      "HEALTHCHECK"
    );
  }

  public static getDiagnosticMessage_ENVRequiresTwoArguments() {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionRequiresTwoArguments"],
      "ENV"
    );
  }

  public static getDiagnosticMessage_InstructionRequiresOneOrThreeArguments() {
    return Validator.dockerProblems["fromRequiresOneOrThreeArguments"];
  }

  public static getDiagnosticMessage_HealthcheckNoneUnnecessaryArgument() {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionUnnecessaryArgument"],
      "HEALTHCHECK NONE"
    );
  }

  public static getDiagnosticMessage_InstructionMultiple(instruction: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionMultiple"],
      instruction
    );
  }

  public static getDiagnosticMessage_InstructionUnknown(instruction: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["instructionUnknown"],
      instruction
    );
  }

  public static getDiagnosticMessage_SyntaxMissingEquals(argument: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["syntaxMissingEquals"],
      argument
    );
  }

  public static getDiagnosticMessage_SyntaxMissingNames(instruction: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["syntaxMissingNames"],
      instruction
    );
  }

  public static getDiagnosticMessage_SyntaxMissingSingleQuote(key: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["syntaxMissingSingleQuote"],
      key
    );
  }

  public static getDiagnosticMessage_SyntaxMissingDoubleQuote(key: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["syntaxMissingDoubleQuote"],
      key
    );
  }

  public static getDiagnosticMessage_InstructionCasing() {
    return Validator.dockerProblems["instructionCasing"];
  }

  public static getDiagnosticMessage_InstructionJSONInSingleQuotes() {
    return Validator.dockerProblems["instructionJSONInSingleQuotes"];
  }

  public static getDiagnosticMessage_OnbuildChainingDisallowed() {
    return Validator.dockerProblems["onbuildChainingDisallowed"];
  }

  public static getDiagnosticMessage_OnbuildTriggerDisallowed(trigger: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["onbuildTriggerDisallowed"],
      trigger
    );
  }

  public static getDiagnosticMessage_VariableModifierUnsupported(
    variable: string,
    modifier: string
  ) {
    return Validator.formatMessage(
      Validator.dockerProblems["variableModifierUnsupported"],
      variable,
      modifier
    );
  }

  public static getDiagnosticMessage_ShellJsonForm() {
    return Validator.dockerProblems["shellJsonForm"];
  }

  public static getDiagnosticMessage_ShellRequiresOne() {
    return Validator.dockerProblems["shellRequiresOne"];
  }

  public static getDiagnosticMessage_DeprecatedMaintainer() {
    return Validator.dockerProblems["deprecatedMaintainer"];
  }

  public static getDiagnosticMessage_HealthcheckCmdArgumentMissing() {
    return Validator.dockerProblems["healthcheckCmdArgumentMissing"];
  }

  public static getDiagnosticMessage_HealthcheckTypeUnknown(type: string) {
    return Validator.formatMessage(
      Validator.dockerProblems["healthcheckTypeUnknown"],
      type
    );
  }

  public static getDiagnosticMessage_WORKDIRPathNotAbsolute() {
    return Validator.formatMessage(
      Validator.dockerProblems["workdirPathNotAbsolute"]
    );
  }

  private static createDuplicatedEscapeDirective(
    start: Position,
    end: Position
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_DirectiveEscapeDuplicated(),
      ValidationCode.DUPLICATED_ESCAPE_DIRECTIVE
    );
  }

  static createInvalidEscapeDirective(
    start: Position,
    end: Position,
    value: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_DirectiveEscapeInvalid(value),
      ValidationCode.INVALID_ESCAPE_DIRECTIVE
    );
  }

  private static createDuplicateBuildStageName(
    range: Range,
    name: string
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_DuplicateBuildStageName(name),
      ValidationCode.DUPLICATE_BUILD_STAGE_NAME
    );
  }

  private static createInvalidBuildStageName(
    range: Range,
    name: string
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_InvalidBuildStageName(name),
      ValidationCode.INVALID_BUILD_STAGE_NAME
    );
  }

  static createFlagAtLeastOne(
    start: Position,
    end: Position,
    flagName: string,
    flagValue: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagAtLeastOne(flagName, flagValue),
      ValidationCode.FLAG_AT_LEAST_ONE
    );
  }

  static createFlagDuplicate(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagDuplicate(flag),
      ValidationCode.FLAG_DUPLICATE
    );
  }

  private static createFlagInvalidDuration(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagInvalidDuration(flag),
      ValidationCode.FLAG_INVALID_DURATION
    );
  }

  private static createFlagLessThan1ms(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagLessThan1ms(flag),
      ValidationCode.FLAG_LESS_THAN_1MS
    );
  }

  private static createFlagMissingDuration(
    start: Position,
    end: Position,
    duration: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagMissingDuration(duration),
      ValidationCode.FLAG_MISSING_DURATION
    );
  }

  private static createFlagInvalidFrom(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagInvalidFromValue(flag),
      ValidationCode.FLAG_INVALID_FROM_VALUE
    );
  }

  static createFlagMissingValue(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagMissingValue(flag),
      ValidationCode.FLAG_MISSING_VALUE
    );
  }

  static createUnknownAddFlag(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagUnknown(flag),
      ValidationCode.UNKNOWN_ADD_FLAG
    );
  }

  static createUnknownCopyFlag(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagUnknown(flag),
      ValidationCode.UNKNOWN_COPY_FLAG
    );
  }

  static createUnknownFromFlag(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagUnknown(flag),
      ValidationCode.UNKNOWN_FROM_FLAG
    );
  }

  static createUnknownHealthcheckFlag(
    start: Position,
    end: Position,
    flag: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_FlagUnknown(flag),
      ValidationCode.UNKNOWN_HEALTHCHECK_FLAG
    );
  }

  private static createFlagUnknownUnit(
    range: Range,
    unit: string,
    duration: string
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_FlagUnknownUnit(unit, duration),
      ValidationCode.FLAG_UNKNOWN_UNIT
    );
  }

  private static createBaseNameEmpty(range: Range, name: string): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_BaseNameEmpty(name),
      ValidationCode.BASE_NAME_EMPTY
    );
  }

  static createInvalidAs(start: Position, end: Position): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InvalidAs(),
      ValidationCode.INVALID_AS
    );
  }

  static createInvalidPort(range: Range, port: string): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_InvalidPort(port),
      ValidationCode.INVALID_PORT
    );
  }

  private static createInvalidProto(
    start: Position,
    end: Position,
    protocol: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InvalidProto(protocol),
      ValidationCode.INVALID_PROTO
    );
  }

  private static createInvalidReferenceFormat(range: Range): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_InvalidReferenceFormat(),
      ValidationCode.INVALID_REFERENCE_FORMAT
    );
  }

  static createInvalidStopSignal(
    start: Position,
    end: Position,
    signal: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InvalidSignal(signal),
      ValidationCode.INVALID_SIGNAL
    );
  }

  static createInvalidSyntax(
    start: Position,
    end: Position,
    syntax: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InvalidSyntax(syntax),
      ValidationCode.INVALID_SYNTAX
    );
  }

  static createMissingArgument(start: Position, end: Position): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InstructionMissingArgument(),
      ValidationCode.ARGUMENT_MISSING
    );
  }

  static createExtraArgument(start: Position, end: Position): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InstructionExtraArgument(),
      ValidationCode.ARGUMENT_EXTRA
    );
  }

  private static createHealthcheckNoneUnnecessaryArgument(
    start: Position,
    end: Position
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_HealthcheckNoneUnnecessaryArgument(),
      ValidationCode.ARGUMENT_UNNECESSARY
    );
  }

  static createARGRequiresOneArgument(
    start: Position,
    end: Position
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_ARGRequiresOneArgument(),
      ValidationCode.ARGUMENT_REQUIRES_ONE
    );
  }

  private static createADDDestinationNotDirectory(range: Range): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_ADDDestinationNotDirectory(),
      ValidationCode.INVALID_DESTINATION
    );
  }

  private static createADDRequiresAtLeastTwoArguments(
    range: Range
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_ADDRequiresAtLeastTwoArguments(),
      ValidationCode.ARGUMENT_REQUIRES_AT_LEAST_TWO
    );
  }

  private static createCOPYDestinationNotDirectory(range: Range): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_COPYDestinationNotDirectory(),
      ValidationCode.INVALID_DESTINATION
    );
  }

  private static createCOPYRequiresAtLeastTwoArguments(
    range: Range
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_COPYRequiresAtLeastTwoArguments(),
      ValidationCode.ARGUMENT_REQUIRES_AT_LEAST_TWO
    );
  }

  static createENVRequiresTwoArguments(
    start: Position,
    end: Position
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_ENVRequiresTwoArguments(),
      ValidationCode.ARGUMENT_REQUIRES_TWO
    );
  }

  private static createHEALTHCHECKRequiresAtLeastOneArgument(
    range: Range
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_HEALTHCHECKRequiresAtLeastOneArgument(),
      ValidationCode.ARGUMENT_REQUIRES_AT_LEAST_ONE
    );
  }

  private static createHealthcheckCmdArgumentMissing(
    start: Position,
    end: Position
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_HealthcheckCmdArgumentMissing(),
      ValidationCode.HEALTHCHECK_CMD_ARGUMENT_MISSING
    );
  }

  private static createHealthcheckTypeUnknown(
    range: Range,
    type: string
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_HealthcheckTypeUnknown(type),
      ValidationCode.UNKNOWN_TYPE
    );
  }

  private static createOnbuildChainingDisallowed(range: Range): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_OnbuildChainingDisallowed(),
      ValidationCode.ONBUILD_CHAINING_DISALLOWED
    );
  }

  private static createOnbuildTriggerDisallowed(
    range: Range,
    trigger: string
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_OnbuildTriggerDisallowed(trigger),
      ValidationCode.ONBUILD_TRIGGER_DISALLOWED
    );
  }

  private static createShellJsonForm(range: Range): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_ShellJsonForm(),
      ValidationCode.SHELL_JSON_FORM
    );
  }

  private static createShellRequiresOne(range: Range): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_ShellRequiresOne(),
      ValidationCode.SHELL_REQUIRES_ONE
    );
  }

  static createRequiresOneOrThreeArguments(
    start: Position,
    end: Position
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InstructionRequiresOneOrThreeArguments(),
      ValidationCode.ARGUMENT_REQUIRES_ONE_OR_THREE
    );
  }

  static createNoSourceImage(start: Position, end: Position): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_NoSourceImage(),
      ValidationCode.NO_SOURCE_IMAGE
    );
  }

  static createSyntaxMissingEquals(
    start: Position,
    end: Position,
    argument: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_SyntaxMissingEquals(argument),
      ValidationCode.SYNTAX_MISSING_EQUALS
    );
  }

  private static createSyntaxMissingSingleQuote(
    start: Position,
    end: Position,
    argument: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_SyntaxMissingSingleQuote(argument),
      ValidationCode.SYNTAX_MISSING_SINGLE_QUOTE
    );
  }

  private static createSyntaxMissingDoubleQuote(
    start: Position,
    end: Position,
    argument: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_SyntaxMissingDoubleQuote(argument),
      ValidationCode.SYNTAX_MISSING_DOUBLE_QUOTE
    );
  }

  private static createSyntaxMissingNames(
    start: Position,
    end: Position,
    instruction: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_SyntaxMissingNames(instruction),
      ValidationCode.SYNTAX_MISSING_NAMES
    );
  }

  private static createVariableUnsupportedModifier(
    range: Range,
    variable: string,
    modifier: string
  ): Diagnostic {
    return Validator.createError(
      range.start,
      range.end,
      Validator.getDiagnosticMessage_VariableModifierUnsupported(
        variable,
        modifier
      ),
      ValidationCode.UNSUPPORTED_MODIFIER
    );
  }

  static createUnknownInstruction(
    start: Position,
    end: Position,
    instruction: string
  ): Diagnostic {
    return Validator.createError(
      start,
      end,
      Validator.getDiagnosticMessage_InstructionUnknown(instruction),
      ValidationCode.UNKNOWN_INSTRUCTION
    );
  }

  static createError(
    start: Position,
    end: Position,
    description: string,
    code?: ValidationCode
  ): Diagnostic {
    return Validator.createDiagnostic(
      DiagnosticSeverity.Error,
      start,
      end,
      description,
      code
    );
  }

  private static createJSONInSingleQuotes(
    range: Range,
    severity: ValidationSeverity | undefined
  ): Diagnostic | null {
    if (severity === ValidationSeverity.ERROR) {
      return Validator.createError(
        range.start,
        range.end,
        Validator.getDiagnosticMessage_InstructionJSONInSingleQuotes(),
        ValidationCode.JSON_IN_SINGLE_QUOTES
      );
    } else if (severity === ValidationSeverity.WARNING) {
      return Validator.createWarning(
        range.start,
        range.end,
        Validator.getDiagnosticMessage_InstructionJSONInSingleQuotes(),
        ValidationCode.JSON_IN_SINGLE_QUOTES
      );
    }
    return null;
  }

  private static createEmptyContinuationLine(
    start: Position,
    end: Position,
    severity: ValidationSeverity | undefined
  ): Diagnostic | null {
    if (severity === ValidationSeverity.ERROR) {
      return Validator.createError(
        start,
        end,
        Validator.getDiagnosticMessage_EmptyContinuationLine(),
        ValidationCode.EMPTY_CONTINUATION_LINE
      );
    } else if (severity === ValidationSeverity.WARNING) {
      return Validator.createWarning(
        start,
        end,
        Validator.getDiagnosticMessage_EmptyContinuationLine(),
        ValidationCode.EMPTY_CONTINUATION_LINE
      );
    }
    return null;
  }

  private createMultipleInstructions(
    range: Range,
    severity: ValidationSeverity | undefined,
    instruction: string
  ): Diagnostic | null {
    if (severity === ValidationSeverity.ERROR) {
      return Validator.createError(
        range.start,
        range.end,
        Validator.getDiagnosticMessage_InstructionMultiple(instruction),
        ValidationCode.MULTIPLE_INSTRUCTIONS
      );
    } else if (severity === ValidationSeverity.WARNING) {
      return Validator.createWarning(
        range.start,
        range.end,
        Validator.getDiagnosticMessage_InstructionMultiple(instruction),
        ValidationCode.MULTIPLE_INSTRUCTIONS
      );
    }
    return null;
  }

  private createLowercaseDirective(
    start: Position,
    end: Position
  ): Diagnostic | null {
    if (this.settings.directiveCasing === ValidationSeverity.ERROR) {
      return Validator.createError(
        start,
        end,
        Validator.getDiagnosticMessage_DirectiveCasing(),
        ValidationCode.CASING_DIRECTIVE
      );
    } else if (this.settings.directiveCasing === ValidationSeverity.WARNING) {
      return Validator.createWarning(
        start,
        end,
        Validator.getDiagnosticMessage_DirectiveCasing(),
        ValidationCode.CASING_DIRECTIVE
      );
    }
    return null;
  }

  createUppercaseInstruction(
    start: Position,
    end: Position
  ): Diagnostic | null {
    if (this.settings.instructionCasing === ValidationSeverity.ERROR) {
      return Validator.createError(
        start,
        end,
        Validator.getDiagnosticMessage_InstructionCasing(),
        ValidationCode.CASING_INSTRUCTION
      );
    } else if (this.settings.instructionCasing === ValidationSeverity.WARNING) {
      return Validator.createWarning(
        start,
        end,
        Validator.getDiagnosticMessage_InstructionCasing(),
        ValidationCode.CASING_INSTRUCTION
      );
    }
    return null;
  }

  createMaintainerDeprecated(
    start: Position,
    end: Position
  ): Diagnostic | null {
    if (this.settings.deprecatedMaintainer === ValidationSeverity.ERROR) {
      return Validator.createError(
        start,
        end,
        Validator.getDiagnosticMessage_DeprecatedMaintainer(),
        ValidationCode.DEPRECATED_MAINTAINER
      );
    } else if (
      this.settings.deprecatedMaintainer === ValidationSeverity.WARNING
    ) {
      return Validator.createWarning(
        start,
        end,
        Validator.getDiagnosticMessage_DeprecatedMaintainer(),
        ValidationCode.DEPRECATED_MAINTAINER
      );
    }
    return null;
  }

  private createWORKDIRNotAbsolute(range: Range): Diagnostic | null {
    if (this.settings.instructionWorkdirRelative === ValidationSeverity.ERROR) {
      return Validator.createError(
        range.start,
        range.end,
        Validator.getDiagnosticMessage_WORKDIRPathNotAbsolute(),
        ValidationCode.WORKDIR_IS_NOT_ABSOLUTE
      );
    } else if (
      this.settings.instructionWorkdirRelative === ValidationSeverity.WARNING
    ) {
      return Validator.createWarning(
        range.start,
        range.end,
        Validator.getDiagnosticMessage_WORKDIRPathNotAbsolute(),
        ValidationCode.WORKDIR_IS_NOT_ABSOLUTE
      );
    }
    return null;
  }

  static createWarning(
    start: Position,
    end: Position,
    description: string,
    code?: ValidationCode
  ): Diagnostic {
    return Validator.createDiagnostic(
      DiagnosticSeverity.Warning,
      start,
      end,
      description,
      code
    );
  }

  static createDockerliveDiagnostic(
    severity: DiagnosticSeverity,
    range: Range,
    description: string,
    code?: ValidationCode
  ): Diagnostic {
    return {
      range: {
        start: range.start,
        end: range.end,
      },
      message: description,
      severity: severity,
      code: code,
      source: "dockerlive",
    };
  }

  static createDiagnostic(
    severity: DiagnosticSeverity,
    start: Position,
    end: Position,
    description: string,
    code?: ValidationCode
  ): Diagnostic {
    return {
      range: {
        start: start,
        end: end,
      },
      message: description,
      severity: severity,
      code: code,
      source: "dockerfile-utils",
    };
  }
}

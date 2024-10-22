import * as vscode from 'vscode';
import * as ts from 'typescript';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "inlinecss2react" is now active!');

    let disposable = vscode.commands.registerCommand('inlinecss2react.convertStyle', () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        const document = activeEditor.document;
        if (document.languageId !== 'typescriptreact' && document.languageId !== 'javascriptreact') {
            vscode.window.showWarningMessage('This extension only works in React files (.tsx/.jsx)');
            return;
        }

        const position = activeEditor.selection.active;
        const sourceFile = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX
        );

        const styleObject = findStyleObjectAtPosition(sourceFile, document.offsetAt(position));
        if (!styleObject) {
            vscode.window.showWarningMessage('No style object found at cursor position');
            return;
        }

        const { node, jsxElement } = styleObject;
        const styleText = document.getText(new vscode.Range(
            document.positionAt(node.getStart()),
            document.positionAt(node.getEnd())
        ));

        // Generate unique style name based on the JSX element
        const elementName = getElementName(jsxElement);
        const baseStyleName = generateUniqueStyleName(elementName, sourceFile);

        // Convert the style object to a proper React style object
        const reactStyle = convertToReactStyle(styleText);

        // Handle existing StyleSheet.create
        const existingStyles = findExistingStyleSheet(sourceFile);
        
        if (existingStyles) {
            // Add to existing StyleSheet.create
            const { node: styleNode, existingNames } = existingStyles;
            const styleStart = styleNode.getStart();
            const objectStart = findObjectLiteralStart(styleNode);
            if (objectStart === -1) return;

            const indent = getIndentation(document, document.positionAt(styleStart).line);
            const newStyle = `${baseStyleName}: ${reactStyle}`;

            activeEditor.edit(editBuilder => {
                // Add new style to existing StyleSheet.create
                const insertPos = document.positionAt(objectStart + 1);
                const prefix = '\n' + indent;
                editBuilder.insert(insertPos, prefix + newStyle + ",");

                // Replace inline style with reference
                editBuilder.replace(new vscode.Range(
                    document.positionAt(node.getStart()),
                    document.positionAt(node.getEnd())
                ), `styles.${baseStyleName}`);
            });
        } else {
            // Create new StyleSheet.create
            const styleObjectText = `\nconst styles = StyleSheet.create({\n    ${baseStyleName}: ${reactStyle}\n});\n`;
            const insertPosition = findInsertPosition(document);

            activeEditor.edit(editBuilder => {
                // Add the style object
                editBuilder.insert(insertPosition, styleObjectText);

                // Replace inline style with reference
                editBuilder.replace(new vscode.Range(
                    document.positionAt(node.getStart()),
                    document.positionAt(node.getEnd())
                ), `styles.${baseStyleName}`);
            });
        }

        vscode.window.showInformationMessage(`Added style: ${baseStyleName}`);
    });

    context.subscriptions.push(disposable);
}

interface StyleObjectInfo {
    node: ts.Node;
    jsxElement: ts.JsxElement | ts.JsxSelfClosingElement;
}

interface ExistingStyleSheet {
    node: ts.Node;
    existingNames: string[];
}

function findExistingStyleSheet(sourceFile: ts.SourceFile): ExistingStyleSheet | undefined {
    let result: ExistingStyleSheet | undefined;

    function visit(node: ts.Node) {
        if (result) return;

        if (ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'create' &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === 'StyleSheet') {
            
            const argument = node.arguments[0];
            if (ts.isObjectLiteralExpression(argument)) {
                const names = argument.properties
                    .filter(ts.isPropertyAssignment)
                    .map(prop => prop.name.getText());
                
                result = {
                    node: node,
                    existingNames: names
                };
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return result;
}

function generateUniqueStyleName(baseName: string, sourceFile: ts.SourceFile): string {
    let styleName = baseName.charAt(0).toLowerCase() + baseName.slice(1);
    
    // Find existing style names
    const existingStyles = findExistingStyleSheet(sourceFile);
    if (existingStyles) {
        const existingNames = existingStyles.existingNames;
        if (existingNames.includes(styleName)) {
            let counter = 1;
            while (existingNames.includes(`${styleName}${counter}`)) {
                counter++;
            }
            styleName = `${styleName}${counter}`;
        }
    }
    
    return styleName;
}

function findObjectLiteralStart(node: ts.Node): number {
    let objectLiteralStart = -1;
    
    function visit(n: ts.Node) {
        if (ts.isObjectLiteralExpression(n)) {
            objectLiteralStart = n.getStart();
            return;
        }
        ts.forEachChild(n, visit);
    }
    
    visit(node);
    return objectLiteralStart;
}

function getIndentation(document: vscode.TextDocument, line: number): string {
    const text = document.lineAt(line).text;
    const match = text.match(/^\s+/);
    return match ? match[0] : '    ';
}

// ... rest of the existing functions (findStyleObjectAtPosition, getElementName, convertToReactStyle, findInsertPosition) remain the same ...

export function deactivate() {}
function isStyleReference(node: ts.Node): boolean {
    // Check if it's a property access (e.g., styles.container)
    if (ts.isPropertyAccessExpression(node)) {
        return true;
    }
    
    // Check if it's a variable/identifier reference
    if (ts.isIdentifier(node)) {
        return true;
    }

    return false;
}
function findStyleObjectAtPosition(sourceFile: ts.SourceFile, position: number): StyleObjectInfo | undefined {
    let styleObject: StyleObjectInfo | undefined;

    function visit(node: ts.Node) {
        if (styleObject) return;

        if (position >= node.getStart() && position <= node.getEnd()) {
            if (ts.isJsxAttribute(node) && node.name.getText() === 'style') {
                // Found style attribute, now get the object literal expression
                const initializer = node.initializer;
                if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
					// Check if it's already a reference to a style object
                    if (isStyleReference(initializer.expression)) {
                        return;
                    }
					// Make sure it's an object literal
                    if (!ts.isObjectLiteralExpression(initializer.expression)) {
                        return;
                    }
                    // Find the parent JSX element
                    let parent: ts.Node | undefined = node.parent;
                    while (parent && !ts.isJsxElement(parent) && !ts.isJsxSelfClosingElement(parent)) {
                        parent = parent.parent;
                    }
                    
                    if (parent && (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent))) {
                        styleObject = {
                            node: initializer.expression,
                            jsxElement: parent as ts.JsxElement | ts.JsxSelfClosingElement
                        };
                        return;
                    }
                }
            }
            ts.forEachChild(node, visit);
        }
    }

    visit(sourceFile);
    return styleObject;
}

function getElementName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
    if (ts.isJsxElement(node)) {
        const tagName = node.openingElement.tagName;
        return ts.isIdentifier(tagName) ? tagName.text : 'element';
    } else {
        const tagName = node.tagName;
        return ts.isIdentifier(tagName) ? tagName.text : 'element';
    }
}

function convertToReactStyle(styleText: string): string {
    // Parse the style text to get an AST
    const sourceFile = ts.createSourceFile(
        'temp.ts',
        styleText,
        ts.ScriptTarget.Latest,
        true
    );

    let formattedStyle = '';
    
    // Visit the AST to format the style object
    function visit(node: ts.Node) {
        if (ts.isObjectLiteralExpression(node)) {
            formattedStyle = '{\n' + node.properties.map(prop => {
                if (ts.isPropertyAssignment(prop)) {
                    const name = prop.name.getText(sourceFile);
                    const value = prop.initializer.getText(sourceFile);
                    return `  ${name}: ${value}`;
                }
                return '';
            }).join(',\n') + '\n}';
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return formattedStyle || styleText;
}

function findInsertPosition(document: vscode.TextDocument): vscode.Position {
    let lastImportLine = -1;
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        if (line.text.trim().startsWith('import')) {
            lastImportLine = i;
        } else if (lastImportLine !== -1 && line.text.trim() !== '') {
            return new vscode.Position(lastImportLine + 2, 0);
        }
    }
    return new vscode.Position(0, 0);
}

